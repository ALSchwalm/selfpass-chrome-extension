import React from 'react';
import ReactDOM from 'react-dom';
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';
import AppBar from 'material-ui/AppBar';
import Drawer from 'material-ui/Drawer';
import MenuItem from 'material-ui/MenuItem';
import TextField from 'material-ui/TextField';
import {GridList, GridTile} from 'material-ui/GridList';
import injectTapEventPlugin from 'react-tap-event-plugin';

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

document.addEventListener("DOMContentLoaded", function() {
  injectTapEventPlugin();
  chrome.runtime.sendMessage({message:"get-keystore"}, function(response){
    console.log(response)
    const style = {
      marginLeft: "256px",
      marginTop: "0px"
    }

    const App = () => (
      <MuiThemeProvider>
        <div>
          <Drawer open={true}>
            <AppBar title="SelfPass" showMenuIconButton={false} />
          </Drawer>
          <div style={style}>
            <AppBar showMenuIconButton={false} />
            <KeystoreView credentialItems={response} />
          </div>
        </div>
      </MuiThemeProvider>
    );

    ReactDOM.render(
      <App />,
      document.getElementById('container')
    );
  })
});
