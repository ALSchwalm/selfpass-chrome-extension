import URL from "url-parse";

/**
 * A simple class that provides an interface for storing and
 * updating a per-domain, per-user history of credentials. This
 * data is stored as follows:
 *
 * {
 *   hosts: {
 *     "host1": {
 *       "username1": [
 *          {
 *             host: "host1",
 *             url: "www.host1.com/foo/bar",
 *             username: "username1",
 *             password: "example",
 *             time: 1481403832
 *          }
 *       ]
 *     }
 *   },
 *   favicons: {
 *     "host1": "ZXhhbXBsZQ=="
 *   }
 * }
 *
 * The list associated with a username will be referred to as a
 * 'credential history' in this documentation.
 */
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

  /**
   * @param url {string} The login url
   * @param username {string}
   * @param password {string}
   * @param favicon {Optional[string]} The base64 encoded favicon
   */
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

  /**
   * A generator yielding pairs of host and credential histories for
   * each username associated with that host.
   */
  *credentials() {
    for (const host in this.store.hosts) {
      yield [host, this.store.hosts[host]];
    }
  }

  /**
   * A generator yielding pairs of host and the current credentials
   * for each user associated with that host.
   */
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

  /**
   * @param url {string}
   * @returns The credential histories of each user associated with
   *          the host matching 'url', or 'null' if none.
   */
  credentialsMatching(url) {
    const host = new URL(url).host;

    if (typeof(this.store.hosts[host]) !== "undefined") {
      return this.store.hosts[host];
    }
    return null;
  }

  /**
   * @param url {string}
   * @returns The current credentials of each user associated with
   *          the host matching 'url', or 'null' if none.
   */
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

  /**
   * @returns A strings representation of this keystore
   */
  serialize() {
    return JSON.stringify(this.store);
  }

  /**
   * Removes all histories of any users associated with 'url'.
   * @param url {string}
   */
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

  /**
   * Merges this keystore with another keystore. The resulting keystore
   * will have merged hosts, users, favicons and histories.
   * @param otherKeystore {Keystore}
   */
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
