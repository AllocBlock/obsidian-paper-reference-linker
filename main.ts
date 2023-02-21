import { Notice, Plugin, TFile } from 'obsidian';
import CrossRef from 'crossref';

const ReMetaHeader = /# [Mm]etadata\s+((- .*:.*\n)*)/
const refInfoTagName = "refInfo"
const ReRefInfo = RegExp(`%%\\s*begin\\s*${refInfoTagName}\\s*%%([\\s\\S]*)%%\\s*end\\s*${refInfoTagName}\\s*%%`)
const ReDoiLink = /\[(.*)\]\(.*\)/

interface PaperInfo {
    file: TFile;
    doi: string;
    refs: Array<string>; // actual paper references
    links: Array<PaperInfo>; // in vault links
}

export default class LinkerPlugin extends Plugin {
    statusBar: HTMLElement;
    isProcessing: boolean;

    async onload() {
        this.isProcessing = false;
        this.statusBar = this.addStatusBarItem();
		this.statusBar.setText('');

        this.addRibbonIcon('dice', 'Gen Paper Links', (evt: MouseEvent) => {
            if (!this.isProcessing) {
                this.isProcessing = true
                this.generateLinks()
            }
            else
                new Notice("已经在生成中...进度可查看右下角状态栏")
        });
    }

    onunload() {

    }

    isTargetNote(text : string) : boolean {
        return !!text.match(ReRefInfo)
    }

    // format like:
    // - doi: abc/123.456
    // - refs: xxx,aaa,yyy
    parseListMap(text : string) : Map<string, string> {
        let listMap = new Map<string, string>()
        let entrys = text.trim().split("\n").map(e => e.slice(2))
        for (let entry of entrys) {
            let splitIndex = entry.indexOf(":")
            let key = entry.slice(0, splitIndex).trim()
            let value = entry.slice(splitIndex + 1).trim()
            listMap.set(key, value)
        }
        return listMap
    }

    extractMetaData(text: string) : Map<string, string> {
        let meta = new Map<string, string>()
        let metaMatchRes = text.match(ReMetaHeader)
        if (metaMatchRes) {
            // TODO: if have meta header but no doi entry, try find the doi?
            meta = this.parseListMap(metaMatchRes[1])
        }
        return meta;
    }

    extractRefInfo(text: string) : Array<string> {
        let metaMatchRes = text.match(ReRefInfo)
        if (metaMatchRes) {
            let listMap = this.parseListMap(metaMatchRes[1])
            for (let pair of listMap) {
                if (pair[0] == "refs") {
                    if (pair[1]) {
                        return pair[1].split(",").map(e => e.trim())
                    }
                }
            }
        }
        return [];
    }

    async getPaperInfos() : Promise<Array<PaperInfo>> {
        const vault = this.app.vault
        const files = vault.getMarkdownFiles()
        
        let paperInfos : Array<PaperInfo> = []
        for (let i = 0; i < files.length; ++i) {
            let file = files[i]
            this.setStatusBarText(`搜索文件 ${i+1}/${files.length}`)

            let text = await vault.read(file);
            if (!this.isTargetNote(text)) continue;

            let meta = this.extractMetaData(text)
            if (!meta.has("DOI")) continue;
            let doi = meta.get("DOI") ?? ""

            let matchDoiLinkRes = doi.match(ReDoiLink)
            if (matchDoiLinkRes) {
                doi = matchDoiLinkRes[1]
            }

            let refs = this.extractRefInfo(text)

            let paperInfo : PaperInfo = {
                file: file,
                doi: doi,
                refs: refs,
                links: []
            }

            paperInfos.push(paperInfo)
        }

        return paperInfos;
    }

    shouldGetRefOnInternet(paperInfo : PaperInfo) : boolean {
        if (paperInfo.refs.length == 0) return true;
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

    generateRefInfo(paperInfo : PaperInfo) : string {
        let metaHeader = `%% begin ${refInfoTagName} %%\n`
        if (paperInfo.refs.length > 0)
            metaHeader += `- refs: ${paperInfo.refs.join(", ")}\n`
        
        if (paperInfo.links.length > 0) {
            let links = paperInfo.links.map((info: PaperInfo) => {
                return `[[${info.file.basename}]]`
            })
            metaHeader += `- ref links: ${links.join(" ")}\n`
        }
        metaHeader += `%% end ${refInfoTagName} %%`

        return metaHeader
    }

    async updateRefInfo(paperInfos : Array<PaperInfo>) : Promise<void> {
        const vault = this.app.vault
        for (let info of paperInfos) {
            let text = await vault.read(info.file);

            // remove original meta header
            let matchRefInfo = text.match(ReRefInfo)
            if (!matchRefInfo) {
                console.error("Error: Reference info block not found")
                continue;
            }
            let insertIndex = matchRefInfo.index ?? 0
            let length = matchRefInfo[0].length
            let beforePart = text.substring(0, insertIndex)
            let afterPart = text.substring(insertIndex + length)
            
            // generate new meta header
            let refInfo = this.generateRefInfo(info)
            
            // append meta header
            let newText = beforePart + refInfo + afterPart

            // save data
            vault.modify(info.file, newText) 
        }
    }

    async generateLinks() : Promise<void> {
        try {
            // console.log("start generation")
            let paperInfos : Array<PaperInfo> = await this.getPaperInfos()
            
            this.setStatusBarText("生成引用...")
            await this.calcReferences(paperInfos)
            this.setStatusBarText("更新文件中的引用...")
            await this.updateRefInfo(paperInfos)
            this.setStatusBarText("")

            // console.log(paperInfos)
            new Notice(`引用生成完成！共统计了「${paperInfos.length}」篇文章。`);
        }
        finally {
            this.isProcessing = false
        }
    }

    setStatusBarText(text : string) {
		this.statusBar.setText(text);
    }
}