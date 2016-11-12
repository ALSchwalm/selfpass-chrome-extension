import URL from "url-parse";

class Keystore {
  constructor(store) {
    if (typeof(store) === "undefined") {
      this.store = {
        hosts: {},
        favicons: {}
      };
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
      time: Math.floor(new Date().getTime() / 1000)
    };

    if (typeof(this.store.hosts[host]) === "undefined") {
      this.store.hosts[host] = {};
    }
    if (typeof(this.store.hosts[host][username] === "undefined")) {
      this.store.hosts[host][username] = [];
    }
    this.store.hosts[host][username].push(entry);

    if (typeof(this.store.favicons[host] === "undefined")) {
      this.store.favicons[host] = favicon;
    }
  }

  *credentials() {
    for (const host in this.store.hosts) {
      yield [host, this.store.hosts[host]];
    }
  }

  *currentCredentials() {
    for (const host in this.store.hosts) {
      const currentCredentials = {};
      for (const username in this.store.hosts[host]) {
        const history = this.store.hosts[host][username];
        currentCredentials[username] = history[history.length-1];
      }
      yield [host, currentCredentials];
    }
  }

  credentialsMatching(url) {
    const host = new URL(url).host;

    if (typeof(this.store.hosts[host]) !== "undefined") {
      return this.store.hosts[host];
    }
    return null;
  }

  currentCredentialsMatching(url) {
    const host = new URL(url).host;
    if (typeof(this.store.hosts[host]) !== "undefined") {
      const currentCredentials = {};
      for (const username in this.store.hosts[host]) {
        const history = this.store.hosts[host][username];
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
    this.store.hosts[host] = null;
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
    for (const host in otherKeystore.store.hosts) {
      if (typeof(this.store.hosts[host]) === "undefined") {
        this.store.hosts[host] = otherKeystore.store.hosts[host];
        continue;
      }

      for (const username in otherKeystore.store.hosts[host]) {
        if (typeof(this.store.hosts[host][username]) === "undefined") {
          this.store.hosts[host][username] = otherKeystore.hosts[host][username];
          continue;
        }

        const history = this.store.hosts[host][username];
        const alternateHistory = otherKeystore.store.hosts[host][username];
        this.store.hosts[host][username] = this._mergeUserHistory(history, alternateHistory);
      }
    }

    // Always use the favicons from the other keystore (they may be
    // more up-to-date)
    for (const host in otherKeystore.store.favicons) {
      this.store.favicons[host] = otherKeystore.store.favicons[host];
    }
  }
}

module.exports = Keystore;
