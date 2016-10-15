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

  *credentials() {
    for (const host in this.store) {
      yield [host, this.store[host]];
    }
  }

  *currentCredentials() {
    for (const host in this.store) {
      const currentCredentials = {};
      for (const username in this.store[host]) {
        const history = this.store[host][username];
        currentCredentials[username] = history[history.length-1];
      }
      yield [host, currentCredentials];
    }
  }

  credentialsMatching(uri) {
    const host = this.parseURI(uri).host;

    if (typeof(this.store[host]) !== "undefined") {
      return this.store[host];
    }
    return null;
  }

  currentCredentialsMatching(uri) {
    const host = this.parseURI(uri).host;
    if (typeof(this.store[host]) !== "undefined") {
      const currentCredentials = {};
      for (const username in this.store[host]) {
        const history = this.store[host][username];
        currentCredentials[username] = history[history.length-1];
      }
      return currentCredentials;
    }
    return null;
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
