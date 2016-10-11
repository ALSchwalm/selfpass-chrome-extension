class Keystore {
  constructor(store) {
    if (typeof(store) === "undefined") {
      this.store = {};
    } else {
      this.store = store;
    }
  }

  parseURI(uri) {
    const parser = document.createElement('a');
    parser.href = uri;
    return parser;
  }

  addCredentials(uri, username, password, favicon) {
    const host = this.parseURI(uri).host;
    const entry = {
      host: host,
      uri: uri,
      username: username,
      password: password,
      favicon: favicon,
      time: new Date()
    };

    if (typeof(this.store[host]) === "undefined") {
      this.store[host] = {};
    }
    if (typeof(this.store[host][username] === "undefined")) {
      this.store[host][username] = [];
    }
    this.store[host][username].push(entry);
  }

  credentialsForUrl(uri) {
    const host = this.parseURI(uri).host;
    if (typeof(this.store[host]) === "undefined") {
      return [];
    }

    var currentCredentials = [];
    for(const username in this.store[host]) {
      const history = this.store[host][username];
      currentCredentials.push(history[history.length-1]);
    }
    return currentCredentials;
  }

  serialize() {
    return JSON.stringify(this.store);
  }

  removeSite(uri){
    const host = this.parseURI(uri).host;

    // This should be removed after the next merge
    this.store[host] = null;
  }
}

module.exports = Keystore;
