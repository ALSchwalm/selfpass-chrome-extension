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


var selfpass = () => chrome.extension.getBackgroundPage().selfpass;

class UnpairedView extends React.Component {
  constructor(...args) {
    super(...args);

    this.pairDevice = e => {
      console.log(this.accessKey.input.value);
      selfpass().pairDevice(
        this.accessKey.input.value,
        this.remoteServerLocation.input.value,
        this.username.input.value,
        this.masterKey.input.value);
    }
  }

  render() {
    const style = {
      input: {
        width: "310px"
      }
    };

    return (
      <div>
        <TextField
            hintText="https://mydomain.com:4999"
            ref={(ref) => this.remoteServerLocation = ref}
            floatingLabelFixed={true}
            style={style.input}
            floatingLabelText="Server Address and Port"/>
        <TextField
            hintText="NQ4A-X3NJ-KXAZ-V53T-NWUR-EKFD"
            ref={(ref) => this.accessKey = ref}
            style={style.input}
            floatingLabelFixed={true}
            floatingLabelText="Access Key"/>
        <TextField
            style={style.input}
            ref={(ref) => this.username = ref}
            floatingLabelText="Username"/>
        <TextField
            style={style.input}
            ref={(ref) => this.masterKey = ref}
            floatingLabelText="Master Password"
            type="password"/>
        <RaisedButton onClick={this.pairDevice}
                      label="Pair Device"
                      fullWidth={true}
                      primary={true} />
      </div>
    );
  }
}

class LoggedOutView extends React.Component {
  constructor(...args) {
    super(...args);

    this.state = {
      isInError: false
    }

    this.login = () => {
      selfpass().login(this.masterKey.input.value, null, () => {
        this.setState({
          isInError: true
        });
      });
    };

    this.onKeyPress = (e) => {
      if (e.key === 'Enter') {
        this.login();
      }
    }
  }

  render() {
    return (
      <div>
        <TextField
            ref={(ref) => this.username = ref}
            floatingLabelText="Username"
            defaultValue={selfpass().state().username}
            type="input"/>
        <TextField
            ref={(ref) => this.masterKey = ref}
            floatingLabelText="Master Password"
            onKeyPress={this.onKeyPress}
            errorText={this.state.isInError ? "Incorrect password" : null}
            type="password"/>
        <br />
        <RaisedButton onClick={this.login} fullWidth={true} label="Login" primary={true} />
      </div>
    );
  }
}

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
