import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
// import CrossRef from 'crossref'; // crossref npm package has bad support and cant find deprecated request pack
import CrossRef from 'crossref';
import { assert } from 'console';

// TODO: update ref immediately after getting meta, for breakpoint restart

// Remember to rename these classes and interfaces!
interface MyPluginSettings {
    mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    mySetting: 'default'
}

const ReMetaHeader = /# [Mm]eta\s+((.*:.*\n)*)/

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings;
    statusBar: HTMLElement;
    isProcessing: boolean;

    async onload() {
        await this.loadSettings();
        this.isProcessing = false;

        this.statusBar = this.addStatusBarItem();
		this.statusBar.setText('');

        // This creates an icon in the left ribbon.
        this.addRibbonIcon('dice', 'Gen Paper Links', (evt: MouseEvent) => {
            if (!this.isProcessing)
                this.generateLinks()
            else
                new Notice("已经在生成中...进度可查看右下角状态栏")
        });

        // This adds a settings tab so the user can configure various aspects of the plugin
        // this.addSettingTab(new SampleSettingTab(this.app, this));
    }

    onunload() {

    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    extractMetaData(text: string) : Map<string, string>{
        let meta = new Map<string, string>()
        let metaMatchRes = text.match(ReMetaHeader)
        if (!metaMatchRes) return meta;
        // TODO: if have meta header but no doi entry, try find the doi?

        let entrys = metaMatchRes[1].trim().split("\n")
        for (let entry of entrys) {
            let splitIndex = entry.indexOf(":")
            let key = entry.slice(0, splitIndex).trim()
            let value = entry.slice(splitIndex + 1).trim()
            meta.set(key, value)
        }
        return meta;
    }

    async calcReferences(dois : Array<string>, inFileRefs : Array<Array<string>>) {
        // get references
        let refsPerPaper = []
        for (let i = 0; i < dois.length; ++i) {
            this.setStatusBarText(`获取参考文献 ${i+1}/${dois.length}`)
            if (inFileRefs[i].length > 0) {
                refsPerPaper.push(inFileRefs[i])
            }
            else {
                let meta = await CrossRef.work(dois[i])
                // TODO: what if this paper is not found?
                // FIXME: what to do with no doi paper?
                let refs = []
                if (meta && meta.message.reference) {
                    for (let ref of meta.message.reference) {
                        if (ref.DOI)
                            refs.push(ref.DOI)
                    }
                }
                refsPerPaper.push(refs)
            }
        }

        // calculate in-vault references
        this.setStatusBarText(`计算引用...`)
        let inVaultDoi = new Set<string>(dois)
        let inVaultRefsPerPaper = []
        for (let refs of refsPerPaper) {
            let inVaultRef = []
            for (let doi of refs) {
                if (inVaultDoi.has(doi)) {
                    inVaultRef.push(doi)
                }
            }
            inVaultRefsPerPaper.push(inVaultRef)
        }

        return {
            refs: refsPerPaper, 
            inVaultRefs: inVaultRefsPerPaper
        }
    }

    async updateMetaHeaders(
        files : Array<TFile>,
        dois : Array<string>,
        refs : Array<Array<string>>, 
        inVaultRefs : Array<Array<string>>
    ) {
        assert(files.length == dois.length)
        assert(files.length == refs.length)
        assert(files.length == inVaultRefs.length)

        const vault = this.app.vault
        for (let i = 0; i < files.length; ++i) {
            let text = await vault.read(files[i]);

            // remove original meta header
            let beforePart = "" // default append at start
            let afterPart = text
            let matchMetaHeader = text.match(ReMetaHeader)
            if (matchMetaHeader) {
                let insertIndex = matchMetaHeader.index ?? 0
                let length = matchMetaHeader[0].length
                beforePart = text.substring(0, insertIndex)
                afterPart = text.substring(insertIndex + length)
            }

            // generate new meta header
            let metaHeader = "# Meta\n"
            metaHeader += `doi: ${dois[i]}\n`
            metaHeader += `refs: ${refs[i].join(", ")}\n`
            let links = inVaultRefs[i].map((doi: string) => {
                let file = files[dois.indexOf(doi)]
                return `[[${file.basename}]]`
            })
            metaHeader += `links: ${links.join(" ")}\n`
            
            // append meta header
            let newText = beforePart + metaHeader + afterPart

            // save data
            vault.modify(files[i], newText)
        }
    }

    async generateLinks() {
        const vault = this.app.vault
        const files = vault.getMarkdownFiles()
        
        let targetFiles : Array<TFile> = []
        let dois : Array<string> = [] 
        let inFileRefsPerPaper : Array<Array<string>> = []
        for (let i = 0; i < files.length; ++i) {
            this.setStatusBarText(`搜索文件 ${i+1}/${files.length}`)
            let file = files[i]

            let text = await vault.read(file);
            let meta = this.extractMetaData(text)
            if (!meta.has("doi")) continue;

            let doi = meta.get("doi") ?? ""

            let inFileRefs : Array<string> = []
            if (meta.has("refs")) {
                let refStr = meta.get("refs")?.trim()
                inFileRefs = refStr?.split(",").map(s => s.trim()) ?? []
            }

            targetFiles.push(file)

            dois.push(doi)
            inFileRefsPerPaper.push(inFileRefs)
        }
        
        this.setStatusBarText("生成引用...")
        let refInfo = await this.calcReferences(dois, inFileRefsPerPaper)
        this.setStatusBarText("更新文件中的引用...")
        await this.updateMetaHeaders(targetFiles, dois, refInfo.refs, refInfo.inVaultRefs)
        this.setStatusBarText("")

        new Notice(`引用生成完成！共统计了${targetFiles.length}篇文章。`);
    }

    setStatusBarText(text : string) {
		this.statusBar.setText(text);
    }
}

// class SampleSettingTab extends PluginSettingTab {
//     plugin: MyPlugin;

//     constructor(app: App, plugin: MyPlugin) {
//         super(app, plugin);
//         this.plugin = plugin;
//     }

//     display(): void {
//         const {containerEl} = this;

//         containerEl.empty();

//         containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});

//         new Setting(containerEl)
//             .setName('Setting #1')
//             .setDesc('It\'s a secret')
//             .addText(text => text
//                 .setPlaceholder('Enter your secret')
//                 .setValue(this.plugin.settings.mySetting)
//                 .onChange(async (value) => {
//                     console.log('Secret: ' + value);
//                     this.plugin.settings.mySetting = value;
//                     await this.plugin.saveSettings();
//                 }));
//     }
// }
