async function work(doi : string) {
    let url = `https://api.crossref.org/works/${doi}`
    // if not found, request will receive "Resource not found", json parse failed
    let jsonData = await fetch(url).then(response => response.json()).catch(_ => null)
    return jsonData
}

export default {
    work,
}