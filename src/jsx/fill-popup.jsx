import React from 'react';
import ReactDOM from 'react-dom';
import {List, ListItem} from 'material-ui/List';
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';
import Settings from 'material-ui/svg-icons/action/settings';
import {grey400, darkBlack, lightBlack} from 'material-ui/styles/colors';
import IconButton from 'material-ui/IconButton';
import MoreVertIcon from 'material-ui/svg-icons/navigation/more-vert';
import IconMenu from 'material-ui/IconMenu';
import MenuItem from 'material-ui/MenuItem';
import injectTapEventPlugin from 'react-tap-event-plugin';

import ChromePromise from "chrome-promise";
const chromep = new ChromePromise();

import $ from "jquery";

function closePopup() {
  chrome.runtime.sendMessage({
    message:"close-fill-popup"
  });
}

class CredentialListItem extends React.Component {
  render() {

    const onClick = (e) => {
      if (!$(e.target).parents('.selfpass-options-button').length) {
        chrome.runtime.sendMessage({
          message:"fill-credentials",
          creds: this.props.creds
        });
      }
    }

    const iconButtonElement = (
      <IconButton className="selfpass-options-button">
        <MoreVertIcon color={grey400} />
      </IconButton>
    );

    const copyField = (field) => {
      return () => {
        var input = document.createElement('textarea');
        document.body.appendChild(input);
        input.value = field;
        input.focus();
        input.select();
        document.execCommand('Copy');
        input.remove();

        closePopup();
      }
    }

    const right = (
      <IconMenu iconButtonElement={iconButtonElement}>
        <MenuItem onTouchTap={copyField(this.props.creds.password)}>
          Copy Password
        </MenuItem>
        <MenuItem onTouchTap={copyField(this.props.creds.username)}>
          Copy Username
        </MenuItem>
        <MenuItem>Edit</MenuItem>
      </IconMenu>
    );

    return <ListItem primaryText={this.props.creds.username}
                     secondaryText={this.props.creds.host}
                     onTouchTap={onClick}
                     rightIcon={right}/>
  }
}

class FillPopupBox extends React.Component {
  render() {
    const self = this;
    return (
      <List>
        {Object.keys(this.props.credentials).map(function(username, i){
           const credentials = self.props.credentials[username];
           return <CredentialListItem creds={credentials} key={i}/>
          })}
      </List>);
  }
};


document.addEventListener("DOMContentLoaded", async function() {
  injectTapEventPlugin();
  const credentials = await chromep.runtime.sendMessage({message:"get-credentials"});
  ReactDOM.render(
    <MuiThemeProvider>
      <FillPopupBox credentials={credentials}/>
    </MuiThemeProvider>,
    document.getElementById('fill-container')
  );
});
