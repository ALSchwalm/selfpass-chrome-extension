import React from 'react';
import ReactDOM from 'react-dom';
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';
import TextField from 'material-ui/TextField';
import Divider from 'material-ui/Divider';
import {List, ListItem} from 'material-ui/List';
import RaisedButton from 'material-ui/RaisedButton';
import IconButton from 'material-ui/IconButton';
import AppBar from 'material-ui/AppBar';
import getMuiTheme from 'material-ui/styles/getMuiTheme';
import injectTapEventPlugin from 'react-tap-event-plugin';

import VPNKey from 'material-ui/svg-icons/communication/vpn-key';
import Cached from 'material-ui/svg-icons/action/cached';
import Exit from 'material-ui/svg-icons/action/exit-to-app';
import NavigationClose from 'material-ui/svg-icons/navigation/close';
import Settings from 'material-ui/svg-icons/action/settings';

import LoggedOutView from './logged-out-view.jsx';
import UnpairedView from './unpaired-view.jsx';

const selfpass = () => chrome.extension.getBackgroundPage().selfpass;

class SelfPassView extends React.Component {
  logout() {
    selfpass().logout();
  }

  onClickKeystore() {
    const url = chrome.extension.getURL("build/html/keystore.html");
    chrome.tabs.create({url: url});
  }

  render() {
    if (!selfpass().isPaired()) {
      return <UnpairedView />;
    } else if (!selfpass().isLoggedIn()) {
      return <LoggedOutView />;
    }
    return (
      <List>
        <ListItem primaryText="Key Store"
                  onClick={this.onClickKeystore}
                  leftIcon={<VPNKey />} />
        <ListItem primaryText="Generate Password" leftIcon={<Cached />} />
        <ListItem primaryText="Settings" leftIcon={<Settings />} />
        <Divider/>
        <ListItem onClick={this.logout} primaryText="Logout" leftIcon={<Exit />} />
    </List>);
  }
}

const theme = getMuiTheme({
  appBar: {
    height: 35,
  },
});

const App = () => (
  <MuiThemeProvider muiTheme={theme}>
    <div>
      <AppBar title="SelfPass"
              showMenuIconButton={false}
              style={{height:"35px"}}
              iconElementRight={<IconButton onClick={e=>window.close()}><NavigationClose /></IconButton>}/>
      <SelfPassView />
    </div>
  </MuiThemeProvider>
);

document.addEventListener("DOMContentLoaded", function(event) {
  injectTapEventPlugin();
  function renderApp(){
    ReactDOM.render(
      <App />,
      document.getElementById('container')
    );
  }
  renderApp();
  setInterval(function() {
    renderApp();
  }, 500);
});
