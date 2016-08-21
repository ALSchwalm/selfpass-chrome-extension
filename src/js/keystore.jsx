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

class SiteGrid extends React.Component {
  render() {
    return (
      <GridList cellHeight={100}
                cols={4}>
        {this.props.credentialItems.map(function(item, index) {
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
    var list = [];
    for (const key in this.props.credentialItems) {
      list = list.concat(this.props.credentialItems[key]);
    }

    return list.filter(function(item){
      if (item.host.includes(s)) {
        return true;
      }
      return false;
    });
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
  }

  render() {
    const style = {
      marginLeft: "256px",
      marginTop: "0px"
    }

    var view;
    if (this.state.activeView === "keystore") {
      view = <KeystoreView credentialItems={this.props.credentials} />
    }

    return <MuiThemeProvider>
        <div>
          <Drawer open={true}>
            <AppBar title="SelfPass" showMenuIconButton={false} />
            <MenuItem primaryText="Keystore" leftIcon={<VPNKey />} />
            <MenuItem primaryText="Settings" leftIcon={<Settings />} />
          </Drawer>
          <div style={style}>
            <AppBar showMenuIconButton={false} />
            {view}
          </div>
        </div>
    </MuiThemeProvider>
  }
}

document.addEventListener("DOMContentLoaded", function() {
  injectTapEventPlugin();
  chrome.runtime.sendMessage({message:"get-keystore"}, function(response){
    console.log(response)

    ReactDOM.render(
      <App credentials={response} />,
      document.getElementById('container')
    );
  })
});
