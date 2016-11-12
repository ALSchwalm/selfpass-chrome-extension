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

import Badge from 'material-ui/Badge';
import VPNKey from 'material-ui/svg-icons/communication/vpn-key';
import Cached from 'material-ui/svg-icons/action/cached';
import Exit from 'material-ui/svg-icons/action/exit-to-app';
import NavigationClose from 'material-ui/svg-icons/navigation/close';
import NavigationBack from 'material-ui/svg-icons/navigation/arrow-back';
import Settings from 'material-ui/svg-icons/action/settings';

import LoggedOutView from './logged-out-view.jsx';
import UnpairedView from './unpaired-view.jsx';
import GeneratePasswordMenu from './generate-password-menu.jsx';

const selfpass = () => chrome.extension.getBackgroundPage().selfpass;

class SelfPassView extends React.Component {
  constructor(...args) {
    super(...args);

    this.state = {
      view: null
    };

    this.onClickGeneratePassword = ()=> {
      this.setState({"view": <GeneratePasswordMenu />});
    }

    this.onClickBack = () => {
      this.setState({"view": null});
    }

    this.onClickLogout = () => {
      selfpass().logout();
    }

    this.onClickKeystore = () => {
      const url = chrome.extension.getURL("build/html/keystore.html");
      chrome.tabs.create({url: url});
    }

    this.wrapInMenu = (elem) => {
      let backButton;
      if (selfpass().isLoggedIn() && this.state.view !== null) {
        backButton = (
          <IconButton onClick={this.onClickBack}>
            <NavigationBack />
          </IconButton>
        );
      } else {
        backButton = <IconButton />;
      }

      return (
        <div>
          <AppBar title="SelfPass"
              style={{height:"35px"}}
              iconElementLeft={backButton}
              iconElementRight={
                <IconButton onClick={e=>window.close()}><NavigationClose /></IconButton>
              }/>
        {elem}
        </div>
      );
    };
  }

  render() {
    if (!selfpass().isPaired()) {
      return this.wrapInMenu(<UnpairedView />);
    } else if (!selfpass().isLoggedIn()) {
      return this.wrapInMenu(<LoggedOutView />);
    }

    if (this.state.view !== null) {
      return this.wrapInMenu(this.state.view);
    }

    let matchingSitesElem = <div />;

    const matchingSites = selfpass().keystore().currentCredentialsMatching(this.props.URL)
    if (matchingSites !== null) {
      const matchingSitesCount = Object.keys(matchingSites).length;
      matchingSitesElem =
        <ListItem
            leftIcon={<Badge
               badgeContent={matchingSitesCount}
               badgeStyle={{right: 35}}
               secondary={true}/>}
            primaryText={"Matching Sites"}
        />;
    }

    return this.wrapInMenu(
      <List>
        <ListItem primaryText="Key Store"
                  onClick={this.onClickKeystore}
                  leftIcon={<VPNKey />} />
        <ListItem primaryText="Generate Password"
                  onClick={this.onClickGeneratePassword}
                  leftIcon={<Cached />} />
        <ListItem primaryText="Settings" leftIcon={<Settings />} />
        {matchingSitesElem}
        <Divider/>
        <ListItem onClick={this.onClickLogout} primaryText="Logout" leftIcon={<Exit />} />
    </List>);
  }
}

const theme = getMuiTheme({
  appBar: {
    height: 35,
  },
});

const App = (url) => (
  <MuiThemeProvider muiTheme={theme}>
      <SelfPassView URL={url}/>
  </MuiThemeProvider>
);

document.addEventListener("DOMContentLoaded", function(event) {
  injectTapEventPlugin();

  function renderApp(){
    chrome.tabs.query({'active': true, currentWindow:true}, (tabs)=>{
      ReactDOM.render(
        App(tabs[0].url),
        document.getElementById('container')
      );
    });
  }

  renderApp();
  setInterval(function() {
    renderApp();
  }, 500);
});
