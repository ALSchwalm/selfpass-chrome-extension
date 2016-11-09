
import assert from "assert";
import Keystore from "../src/js/keystore.js";

describe('Keystore', function(){
  describe('#addCredentials', function() {
    let keystore;

    beforeEach(function(){
      keystore = new Keystore();
    });

    it('should create missing host and username entries', function(){
      const url = "http://www.google.com";
      const host = "www.google.com";
      const username = "username";
      const password = "password";
      const favicon = "";

      keystore.addCredentials(url, username, password, favicon);
      assert(typeof(keystore.store[host]) !== "undefined");
      assert(typeof(keystore.store[host][username]) !== "undefined");
    });

    it('should add a new entry with the given username and password', function(){
      const url = "http://www.google.com";
      const host = "www.google.com";
      const username = "username";
      const password = "password";
      const favicon = "";

      keystore.addCredentials(url, username, password, favicon);
      assert(keystore.store[host][username].length === 1);

      const entry = keystore.store[host][username][0];

      assert(entry.username === username);
      assert(entry.password === password);
    });

    it('should add a new entry with the current time (in seconds since epoch)', function(){
      const url = "http://www.google.com";
      const host = "www.google.com";
      const username = "username";
      const password = "password";
      const favicon = "";

      const currentTime = Math.floor(new Date().getTime() / 1000);
      keystore.addCredentials(url, username, password, favicon);
      const entry = keystore.store[host][username][0];

      assert(entry.time === currentTime);
    });
  });

  describe('#credentials', function(){
    let keystore;

    beforeEach(function(){
      keystore = new Keystore();
    });

    it('should start out empty', function(){
      assert([...keystore.credentials()].length === 0);
    });

    it('should yield pairs of (host, credential-history)', function(){
      const url = "http://www.google.com";
      const host = "www.google.com";
      const username = "username";
      const password = "password";
      const favicon = "";
      keystore.addCredentials(url, username, password, favicon);
      const credentials = [...keystore.credentials()];
      assert(credentials.length === 1);

      const addedCredentials = credentials[0];
      assert(addedCredentials.length === 2);

      assert(addedCredentials[0] === host);
      assert(Object.keys(addedCredentials[1]).length === 1);

      const userHistory = addedCredentials[1][username];
      assert(userHistory.length === 1);
      assert(userHistory[0].username === username);
      assert(userHistory[0].host === host);
      assert(userHistory[0].password === password);
    });
  });

  describe('#currentCredentials', function(){
    let keystore;

    beforeEach(function(){
      keystore = new Keystore();
    });

    it('should start out empty', function(){
      assert([...keystore.currentCredentials()].length === 0);
    });

    it('should yield pairs of (host, current-credential)', function(){
      const url = "http://www.google.com";
      const host = "www.google.com";
      const username = "username";
      const password = "password";
      const favicon = "";
      keystore.addCredentials(url, username, password, favicon);
      const credentials = [...keystore.currentCredentials()];
      assert(credentials.length === 1);

      const addedCredentials = credentials[0];
      assert(addedCredentials.length === 2);

      assert(addedCredentials[0] === host);
      assert(Object.keys(addedCredentials[1]).length === 1);

      const currentCredentials = addedCredentials[1][username];
      assert(currentCredentials.username === username);
      assert(currentCredentials.host === host);
      assert(currentCredentials.password === password);
    });
  });

  describe('#credentialsMatching', function(){
    let keystore;

    beforeEach(function(){
      keystore = new Keystore();
    });

    it('should return null on invalid URL', function(){
      const credentials = keystore.credentialsMatching("foo");
      assert(credentials === null);
    });

    it('should return null when no hostname matches', function(){
      const credentials = keystore.credentialsMatching("www.example.com");
      assert(credentials === null);
    });

    it('should return a credential history when hostname matches', function(){
      const url = "http://www.google.com";
      const username = "username";
      const password = "password";
      const favicon = "";
      keystore.addCredentials(url, username, password, favicon);

      const credentials = keystore.credentialsMatching("http://www.google.com");
      assert(Object.keys(credentials).length === 1);
      assert(credentials[username].length === 1);
      assert(credentials[username][0].username === username);
      assert(credentials[username][0].password === password);
    });
  });

  describe('#currentCredentialsMatching', function(){
    let keystore;

    beforeEach(function(){
      keystore = new Keystore();
    });

    it('should return null on invalid URL', function(){
      const credentials = keystore.currentCredentialsMatching("foo");
      assert(credentials === null);
    });

    it('should return null when no hostname matches', function(){
      const credentials = keystore.currentCredentialsMatching("www.example.com");
      assert(credentials === null);
    });

    it('should return the current credentials when hostname matches', function(){
      const url = "http://www.google.com";
      const username = "username";
      const password = "password";
      const favicon = "";
      keystore.addCredentials(url, username, password, favicon);

      const credentials = keystore.currentCredentialsMatching("http://www.google.com");
      assert(Object.keys(credentials).length === 1);
      assert(credentials[username].username === username);
      assert(credentials[username].password === password);
    });
  });

  describe('#merge', function(){
    let current;
    let alternate;

    beforeEach(function(){
      current = new Keystore();
      alternate = new Keystore();
    });

    it('should have no effect when alternate keystore is empty', function(){
      const url = "http://www.google.com";
      const username = "username";
      const password = "password";
      const favicon = "";
      current.addCredentials(url, username, password, favicon);

      current.merge(alternate);
      assert([...current.credentials()].length === 1);
    });

    it('should add hostnames from alternate that are missing from current', function(){
      const url = "http://www.google.com";
      const url2 = "http://www.example.com";
      const username = "username";
      const password = "password";
      const favicon = "";
      current.addCredentials(url, username, password, favicon);
      alternate.addCredentials(url2, username, password, favicon);

      current.merge(alternate);
      assert([...current.credentials()].length === 2);
    });

    it('should remove duplicate entries', function(){
      const url = "http://www.google.com";
      const username = "username";
      const password = "password";
      const favicon = "";
      current.addCredentials(url, username, password, favicon);
      alternate.addCredentials(url, username, password, favicon);

      current.merge(alternate);
      const mergedCredentials = [...current.credentials()];
      assert(mergedCredentials.length === 1);
      assert(mergedCredentials[0][1][username].length === 1);
    });

    it('should keep entries for the same user but different passwords', function(){
      const url = "http://www.google.com";
      const username = "username";
      const password = "password";
      const password2 = "example";
      const favicon = "";
      current.addCredentials(url, username, password, favicon);
      alternate.addCredentials(url, username, password2, favicon);

      current.merge(alternate);
      const mergedCredentials = [...current.credentials()];
      assert(mergedCredentials.length === 1);
      assert(mergedCredentials[0][1][username].length === 2);
    });

    it('should order merged user histories by time', function(){
      const url = "http://www.google.com";
      const username = "username";
      const password = "password";
      const password2 = "example";
      const favicon = "";
      current.addCredentials(url, username, password, favicon);
      alternate.addCredentials(url, username, password2, favicon);
      alternate.store["www.google.com"][username][0].time += 100;

      current.merge(alternate);
      const mergedCredentials = [...current.credentials()];
      assert(mergedCredentials.length === 1);

      const userHistory = mergedCredentials[0][1][username];
      assert(userHistory.length === 2);

      assert(userHistory[0].time < userHistory[1].time);
    });
  });
});
