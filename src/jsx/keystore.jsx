import React from 'react';
import ReactDOM from 'react-dom';
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';
import AppBar from 'material-ui/AppBar';
import Drawer from 'material-ui/Drawer';
import Dialog from 'material-ui/Dialog';
import MenuItem from 'material-ui/MenuItem';
import TextField from 'material-ui/TextField';
import {Table, TableBody, TableHeader, TableHeaderColumn, TableRow, TableRowColumn} from 'material-ui/Table';
import {GridList, GridTile} from 'material-ui/GridList';
import injectTapEventPlugin from 'react-tap-event-plugin';
import VPNKey from 'material-ui/svg-icons/communication/vpn-key';
import Settings from 'material-ui/svg-icons/action/settings';
import Exit from 'material-ui/svg-icons/action/exit-to-app';
import RaisedButton from 'material-ui/RaisedButton';

import LoggedOutView from './logged-out-view.jsx';
import UnpairedView from './unpaired-view.jsx';

const selfpass = () => chrome.extension.getBackgroundPage().selfpass;

class AccountsDialog extends React.Component {
  render() {
    return <Dialog
               title={`Accounts for '${this.props.host}'`}
               modal={false}
               open={true}
               onRequestClose={this.props.handleClose}
           >
        <Table selectable={false}>
          <TableHeader displaySelectAll={false}
                       adjustForCheckbox={false}>
            <TableRow>
              <TableHeaderColumn>Username</TableHeaderColumn>
              <TableHeaderColumn>Password</TableHeaderColumn>
              <TableHeaderColumn />
            </TableRow>
          </TableHeader>
          <TableBody displayRowCheckbox={false}>
            {Object.keys(this.props.credentials).map((username, i)=>{
               return (
                 <TableRow key={i}>
                   <TableRowColumn>
                     {username}
                   </TableRowColumn>
                   <TableRowColumn>
                     {this.props.credentials[username][0].password}
                   </TableRowColumn>
                   <TableRowColumn>
                     <RaisedButton>Edit</RaisedButton>
                   </TableRowColumn>
                 </TableRow>
               );
             })}
          </TableBody>
        </Table>
    </Dialog>
  }
}

class SiteGrid extends React.Component {
  constructor(...args) {
    super(...args);

    this.state = {
      menuCredentials: null,
      menuHost: null
    }

    this.showPopup = (credendials, host) => {
      this.setState({"menuCredentials": credendials});
      this.setState({"menuHost": host});
    }

    this.handleClose = () => {
      this.setState({"menuCredentials" : null});
      this.setState({"menuHost" : null});
    }
  }

  render() {
    const credentialItems = this.props.credentialItems;

    const numColumns = (window.innerWidth > 1000) ? 4 : 3;

    let dialog;
    if (this.state.menuCredentials !== null) {
      dialog = <AccountsDialog credentials={this.state.menuCredentials}
                               host={this.state.menuHost}
                               handleClose={this.handleClose} />;
    } else {
      dialog = <div/>
    }

    return (
      <div>
        {dialog}
        <GridList cellHeight={100}
                  cols={numColumns}>
          {Object.keys(credentialItems).map((host, index) => {
             let img = null;
             if (credentialItems[host].favicon) {
               img = <img style={{width: "24px", height:"24px", paddingRight: "10px"}}
                          src={credentialItems[host].favicon} />;
             }

             const users = Object.keys(credentialItems[host].users)
                                 .reduce((combined, entry) => {
                                   return combined + ", " + entry
                                 });

             return <GridTile
                        onTouchTap={()=>{
                            this.showPopup(credentialItems[host].users, host)
                          }}
                        key={index}
                        title={host}
                        actionIcon={img}
                        subtitle={users} />
           })}
        </GridList>
      </div>
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

    for (const host in this.props.keystore.store.hosts) {
      if (host.includes(s)) {
        credentials[host] = {
          users: this.props.keystore.store.hosts[host],
          favicon: this.props.keystore.store.favicons[host]
        };
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

  window.onresize = function(event) {
    renderApp();
  };
});
