# Obsidian Paper Reference Linker
## Introduction
- create link between paper notes by finding references on internet
- based on crossref's api
  
## Usage
- Add meta header to all paper notess you want
- For example
```markdown
# Meta
doi: XXXXXX
```
- You can use comment to hide it in view mode
```markdown
%%
# Meta
doi: XXXXXX
%%
```

- Click "Gen Paper Link" button on Ribbon
- DOI will be extracted and used for references query
- References and links will be append to the meta data
- Result looks like this:
  - ![Result](images/result.png)
  - ![Result Graph](images/result-graph.png)