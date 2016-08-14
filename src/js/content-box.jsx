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


class CredentialListItem extends React.Component {
  render() {
    const iconButtonElement = (
      <IconButton>
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
                     rightIcon={right}/>
  }
}

class ContentPopupBox extends React.Component {
  render() {
    return (
      <List>
        {this.props.credentialList.map(function(credential){
           return <CredentialListItem creds={credential}/>
          })}
      </List>);
  }
};


document.addEventListener("DOMContentLoaded", function() {
  injectTapEventPlugin();
  chrome.runtime.sendMessage("get-credentials", function(credentialList){
    ReactDOM.render(
      <MuiThemeProvider>
        <ContentPopupBox credentialList={credentialList}/>
      </MuiThemeProvider>,
      document.getElementById('container')
    );
  });
});
