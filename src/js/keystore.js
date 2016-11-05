import URL from "url-parse";

class Keystore {
  constructor(store) {
    if (typeof(store) === "undefined") {
      this.store = {};
    } else {
      this.store = store;
    }
  }

  addCredentials(url, username, password, favicon) {
    const host = new URL(url).host;
    const entry = {
      host: host,
      url: url,
      username: username,
      password: password,
      favicon: favicon,
      time: Math.floor(new Date().getTime() / 1000)
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

  credentialsMatching(url) {
    const host = new URL(url).host;

    if (typeof(this.store[host]) !== "undefined") {
      return this.store[host];
    }
    return null;
  }

  currentCredentialsMatching(url) {
    const host = new URL(url).host;
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

  removeSite(url){
    const host = new URL(url).host;

    // This should be removed after the next merge
    this.store[host] = null;
  }

  _mergeUserHistory(currentHistory, alternateHistory) {
    var mergedHistory = [];
    var ci = 0;
    var ai = 0;

    while(ci < currentHistory.length && ai < alternateHistory.length) {
      const currentItem = currentHistory[ci];
      const alternateItem = alternateHistory[ai];

      if (currentItem.password === alternateItem.password) {
        mergedHistory.push(currentItem);
        ai += 1;
        ci += 1;
        continue;
      }
      if (alternateItem.time < currentItem.time) {
        mergedHistory.push(alternateItem);
        ai += 1;
      } else {
        mergedHistory.push(currentItem);
        ci += 1;
      }
    }

    if (ci < currentHistory.length) {
      mergedHistory = mergedHistory.concat(currentHistory.slice(ci));
    } else if (ai < alternateHistory.length) {
      mergedHistory = mergedHistory.concat(alternateHistory.slice(ai));
    }

    return mergedHistory;
  }

  merge(otherKeystore) {
    for (const host in otherKeystore.store) {
      if (typeof(this.store[host]) === "undefined") {
        this.store[host] = otherKeystore.store[host];
        continue;
      }

      for (const username in otherKeystore.store[host]) {
        if (typeof(this.store[host][username]) === "undefined") {
          this.store[host][username] = otherKeystore[host][username];
          continue;
        }

        const history = this.store[host][username];
        const alternateHistory = otherKeystore.store[host][username];
        this.store[host][username] = this._mergeUserHistory(history, alternateHistory);
      }
    }
  }
}

module.exports = Keystore;
