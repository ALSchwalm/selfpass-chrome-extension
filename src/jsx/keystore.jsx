import React from 'react';
import ReactDOM from 'react-dom';
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';
import AppBar from 'material-ui/AppBar';
import Drawer from 'material-ui/Drawer';
import MenuItem from 'material-ui/MenuItem';
import TextField from 'material-ui/TextField';
import {GridList, GridTile} from 'material-ui/GridList';
import injectTapEventPlugin from 'react-tap-event-plugin';
import VPNKey from 'material-ui/svg-icons/communication/vpn-key';
import Settings from 'material-ui/svg-icons/action/settings';
import Exit from 'material-ui/svg-icons/action/exit-to-app';
import RaisedButton from 'material-ui/RaisedButton';

import LoggedOutView from './logged-out-view.jsx';
import UnpairedView from './unpaired-view.jsx';

const selfpass = () => chrome.extension.getBackgroundPage().selfpass;

class SiteGrid extends React.Component {
  render() {
    const credentialItems = this.props.credentialItems;
    const currentCredentials = [];

    Object.keys(credentialItems).map((host) => {
      Object.keys(credentialItems[host]).map((username) => {
        const credentialHistory = credentialItems[host][username];

        currentCredentials.push(credentialHistory[credentialHistory.length-1])
      });
    });

    return (
      <GridList cellHeight={100}
                cols={4}>
        {currentCredentials.map((item, index) => {
           var img = null;
           if (item.favicon) {
             img = <img style={{width: "24px", height:"24px", paddingRight: "10px"}}
                        src={item.favicon} />;
           }
           return <GridTile
               key={index}
               title={item.host}
               actionIcon={img}
               subtitle={item.username} />
         })}
      </GridList>
    )
  }
}

class KeystoreView extends React.Component {
  constructor(...args) {
    super(...args);

    this.state = {
      searchString: ""
    }

    this.onSearchChange = (e) => {
      this.setState({
        searchString: e.target.value
      })
    }
  }

  filterCredentials(s) {
    var credentials = {};

    for (const host in this.props.keystore.store) {
      if (host.includes(s)) {
        credentials[host] = this.props.keystore.store[host];
      }
    }

    return credentials;
  }

  render() {
    const style = {
      page: {
        margin: "50px"
      },
      search: {
        width: "80%"
      }
    }

    return (
      <div style={style.page}>
        <TextField style={style.search}
                   value={this.state.searchString}
                   fullWidth={true}
                   onChange={this.onSearchChange}
                   hintText="Search" />
        <SiteGrid credentialItems={this.filterCredentials(this.state.searchString)} />
      </div>
    );
  }
}

class App extends React.Component {
  constructor(...args) {
    super(...args);

    this.state = {
      activeView: "keystore"
    }

    this.logout = () => {
      chrome.runtime.sendMessage({message:"logout"});
    }
  }

  render() {
    const style = {
      rightBar: {
        marginLeft: "256px",
        marginTop: "0px"
      },
      minimal: {
        width:"280px",
        margin:"auto"
      }
    }

    if (!selfpass().isPaired()) {
      return (
        <div style={style.minimal}>
          <UnpairedView />
        </div>
      )
    } else if (!selfpass().isLoggedIn()) {
      return (
        <div style={style.minimal}>
          <LoggedOutView />
        </div>
      )
    }

    const credentials = selfpass().keystore();

    var view;
    if (this.state.activeView === "keystore") {
      view = <KeystoreView keystore={credentials} />
    }

    return (
      <div>
        <Drawer open={true}>
          <AppBar title="SelfPass"
                  showMenuIconButton={false} />
          <MenuItem primaryText="Keystore" leftIcon={<VPNKey />} />
          <MenuItem primaryText="Settings" leftIcon={<Settings />} />
        </Drawer>
        <div style={style.rightBar}>
          <AppBar showMenuIconButton={false}
                  iconElementRight={<RaisedButton label="Logout"
                                                    onClick={this.logout}
                                                    icon={<Exit />} /> } />
          {view}
        </div>
      </div>)
  }
}

document.addEventListener("DOMContentLoaded", function() {
  injectTapEventPlugin();

  function renderApp() {
    ReactDOM.render(
      <MuiThemeProvider>
        <App />
      </MuiThemeProvider>,
      document.getElementById('container')
    );
  }
  renderApp();
  setInterval(function() {
    renderApp();
  }, 500);
});
