import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import CrossRef from 'crossref';

// TODO: update ref immediately after getting meta, for breakpoint restart

interface LinkerPluginSettings {
    saveYear: boolean;
}

const DEFAULT_SETTINGS: LinkerPluginSettings = {
    saveYear: true
}

const ReMetaHeader = /# [Mm]eta\s+((.*:.*\n)*)/

interface PaperInfo {
    file: TFile;
    doi: string;
    refs: Array<string>; // actual paper references
    links: Array<PaperInfo>; // in vault links
    extraMeta: Map<string, string>;
}

export default class LinkerPlugin extends Plugin {
    settings: LinkerPluginSettings;
    statusBar: HTMLElement;
    isProcessing: boolean;

    async onload() {
        await this.loadSettings();

        this.isProcessing = false;
        this.statusBar = this.addStatusBarItem();
		this.statusBar.setText('');

        this.addRibbonIcon('dice', 'Gen Paper Links', (evt: MouseEvent) => {
            if (!this.isProcessing)
                this.generateLinks()
            else
                new Notice("已经在生成中...进度可查看右下角状态栏")
        });

        this.addSettingTab(new LinkerSettingTab(this.app, this));
    }

    onunload() {

    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    extractMetaData(text: string) : Map<string, string> {
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

    async getPaperInfos() : Promise<Array<PaperInfo>> {
        const vault = this.app.vault
        const files = vault.getMarkdownFiles()
        
        let paperInfos : Array<PaperInfo> = []
        for (let i = 0; i < files.length; ++i) {
            let file = files[i]
            this.setStatusBarText(`搜索文件 ${i+1}/${files.length}`)

            let text = await vault.read(file);
            let meta = this.extractMetaData(text)
            if (!meta.has("doi")) continue;

            let doi = meta.get("doi") ?? ""

            let refs : Array<string> = []
            if (meta.has("refs")) {
                let refStr = meta.get("refs")?.trim()
                if (refStr)
                    refs = refStr?.split(",").map(s => s.trim()) ?? []
                else
                    refs = []
            }

            let paperInfo : PaperInfo = {
                file: file,
                doi: doi,
                refs: refs,
                links: [],
                extraMeta: meta
            }

            paperInfos.push(paperInfo)
        }

        return paperInfos;
    }

    shouldGetRefOnInternet(paperInfo : PaperInfo) : boolean {
        if (paperInfo.refs.length == 0) return true;
        else if (this.settings.saveYear && !paperInfo.extraMeta.has("year")) return true;
        return false;
    }

    async calcReferences(paperInfos : Array<PaperInfo>) : Promise<void> {
        // get references on internet if not found in file
        for (let i = 0; i < paperInfos.length; ++i) {
            let info = paperInfos[i]
            this.setStatusBarText(`获取参考文献 ${i+1}/${paperInfos.length}`)

            if (this.shouldGetRefOnInternet(info)) {
                let meta = await CrossRef.work(info.doi)
                // TODO: what if this paper is not found?
                // FIXME: what to do with no doi paper?
                if (meta) {
                    if (meta.message.reference) {
                        for (let ref of meta.message.reference) {
                            if (ref.DOI && ref.DOI.trim())
                                info.refs.push(ref.DOI.trim())
                        }
                    }
                    
                    if (this.settings.saveYear && meta.message?.['published-print']?.['date-parts']?.[0]?.[0]) {
                        info.extraMeta.set("year", meta.message['published-print']['date-parts'][0][0])
                    }
                }
            }
        }

        // calculate in-vault references
        this.setStatusBarText(`计算引用...`)
        let doiMap = new Map<string, PaperInfo>()
        for (let info of paperInfos) {
            if (doiMap.has(info.doi)) {
                let existedInfo = doiMap.get(info.doi)
                if (existedInfo)
                    new Notice(`警告：${info.file.basename}中的doi与${existedInfo.file.basename}的doi相同！`)
            }
            else {
                doiMap.set(info.doi, info)
            }
        }

        for (let info of paperInfos) {
            for (let doi of info.refs) {
                if (doiMap.has(doi)) {
                    let linkInfo = doiMap.get(doi)
                    if (linkInfo)
                        info.links.push(linkInfo)
                }
            }
        }
    }

    generateMetaHeader(paperInfo : PaperInfo) : string {
        let metaHeader = "# Meta\n"
        metaHeader += `doi: ${paperInfo.doi}\n`

        if (this.settings.saveYear && paperInfo.extraMeta.has("year")) {
            let year = paperInfo.extraMeta.get("year")
            metaHeader += `year: ${year}\n`
        }

        if (paperInfo.refs.length > 0)
            metaHeader += `refs: ${paperInfo.refs.join(", ")}\n`
        
        if (paperInfo.links.length > 0) {
            let links = paperInfo.links.map((info: PaperInfo) => {
                return `[[${info.file.basename}]]`
            })
            metaHeader += `links: ${links.join(" ")}\n`
        }

        return metaHeader
    }

    async updateMetaHeaders(paperInfos : Array<PaperInfo>) : Promise<void> {
        const vault = this.app.vault
        for (let info of paperInfos) {
            let text = await vault.read(info.file);

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
            let metaHeader = this.generateMetaHeader(info)
            console.log(metaHeader)
            
            // append meta header
            let newText = beforePart + metaHeader + afterPart

            // save data
            vault.modify(info.file, newText) 
        }
    }

    async generateLinks() : Promise<void> {
        console.log("start generation")
        let paperInfos : Array<PaperInfo> = await this.getPaperInfos()
        
        this.setStatusBarText("生成引用...")
        await this.calcReferences(paperInfos)
        this.setStatusBarText("更新文件中的引用...")
        await this.updateMetaHeaders(paperInfos)
        this.setStatusBarText("")

        console.log(paperInfos)

        new Notice(`引用生成完成！共统计了${paperInfos.length}篇文章。`);
    }

    setStatusBarText(text : string) {
		this.statusBar.setText(text);
    }
}

class LinkerSettingTab extends PluginSettingTab {
    plugin: LinkerPlugin;

    constructor(app: App, plugin: LinkerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

        containerEl.createEl('h2', {text: '保存选项'});

        new Setting(containerEl)
            .setName('年份')
            .addToggle(comp => comp
                .setValue(this.plugin.settings.saveYear)
                .onChange(async (value) => {
                    this.plugin.settings.saveYear = value;
                    await this.plugin.saveSettings();
                }));
    }
}
