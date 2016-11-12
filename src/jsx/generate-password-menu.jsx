import React from 'react';
import ReactDOM from 'react-dom';
import {List, ListItem} from 'material-ui/List';
import Settings from 'material-ui/svg-icons/action/settings';
import {grey400, darkBlack, lightBlack} from 'material-ui/styles/colors';
import IconButton from 'material-ui/IconButton';
import MoreVertIcon from 'material-ui/svg-icons/navigation/more-vert';
import IconMenu from 'material-ui/IconMenu';
import MenuItem from 'material-ui/MenuItem';
import TextField from 'material-ui/TextField';
import Divider from 'material-ui/Divider';
import RaisedButton from 'material-ui/RaisedButton';
import Toggle from 'material-ui/Toggle';
import Subheader from 'material-ui/Subheader';
import Checkbox from 'material-ui/Checkbox';
import Refresh from 'material-ui/svg-icons/navigation/refresh';
import CheckCircle from 'material-ui/svg-icons/action/check-circle';

class GeneratePasswordMenu extends React.Component {
  constructor(...args) {
    super(...args);

    this.state = {
      advancedOpen: false,
      useLetters: true,
      useNumbers: true,
      useSpecialCharacters: false,
      passwordLength: 12,
      password: "",
      username: decodeURIComponent(window.location.search.split("=")[1] || ""),
      saved: false
    }

    this.generatePassword = () => {
      var password = new Uint8Array(this.state.passwordLength);
      window.crypto.getRandomValues(password);
      password = Array.from(password);

      var alphabet = "";
      if (this.state.useLetters) {
        alphabet += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      }
      if (this.state.useNumbers) {
        alphabet += "0123456789";
      }
      if (this.state.useSpecialCharacters) {
        alphabet += "!@#$%^&*<>=[]{}(),.?;:|`~/\\-_";
      }

      for (var i=0; i < password.length; ++i) {
        //FIXME: this introduces a slight bias

        password[i] = alphabet[password[i] % alphabet.length];
      }

      return password.join("");
    }

    this.updatePassword = () => {
      this.setState({
        password: this.generatePassword()
      });
    }

    this.onUsernameChange = (e) => {
      this.setState({
        username: e.target.value
      });
    }

    this.toggleAdvancedOpen = () => {
      this.setState({
        advancedOpen: !this.state.advancedOpen,
      });
    }

    this.changePasswordLength = (e) => {
      if (e.target.value == this.state.passwordLength) {
        return;
      }
      this.setState({
        passwordLength: e.target.value,
      }, function(){
        this.updatePassword();
      });
    }

    this.toggleUseLetters = () => {
      this.setState({
        useLetters: !this.state.useLetters,
      }, function(){
        this.updatePassword();
      });
    }

    this.toggleUseNumbers = () => {
      this.setState({
        useNumbers: !this.state.useNumbers,
      }, function(){
        this.updatePassword();
      });
    }

    this.toggleUseSpecialCharacters = () => {
      this.setState({
        useSpecialCharacters: !this.state.useSpecialCharacters,
      }, function(){
        this.updatePassword();
      });
    }

    this.onSave = () => {
      if (this.state.saved) {
        return;
      }

      console.log("Sending fill message", this.state.username);

      chrome.runtime.sendMessage({
        message:"request-save-credentials",
        password: this.state.password,
        username: this.state.username
      });

      chrome.runtime.sendMessage({
        message:"fill-generated-password",
        password: this.state.password,
        username: this.state.username
      });

      this.setState({"saved": true});
    }
  }

  componentWillMount() {
    this.updatePassword();
  }

  render() {
    var advancedOptions;
    if (this.state.advancedOpen) {
      advancedOptions =
        <div>
          <TextField type='number'
                     value={this.state.passwordLength}
                     onChange={this.changePasswordLength}
                     floatingLabelFixed={true}
                     floatingLabelText="Password length" />
          <Checkbox label="Letters"
                    onCheck={this.toggleUseLetters}
                    checked={this.state.useLetters} />
          <Checkbox label="Numbers"
                    onCheck={this.toggleUseNumbers}
                    checked={this.state.useNumbers} />
          <Checkbox label="Special Characters"
                    onCheck={this.toggleUseSpecialCharacters}
                    checked={this.state.useSpecialCharacters}/>
        </div>
    } else {
      advancedOptions = <div />
    }

    const savedButtonStyle = {width: "48%",
                              position: "relative",
                              right: "-10px"};
    let saveButton;
    if (this.state.saved) {
      saveButton = <RaisedButton icon={<CheckCircle />}
                                 style={savedButtonStyle}
                                 primary={true} />;
    } else {
      saveButton = <RaisedButton label="Save"
                                 onClick={this.onSave}
                                 style={savedButtonStyle}
                                 primary={true} />;
    }

    return (
      <div>
        <TextField
            value={this.state.username}
            onChange={this.onUsernameChange}
            hintText="Username"/>
        <TextField
            value={this.state.password}
            hintText="Password" />
        <Toggle label="Advanced Options" onToggle={this.toggleAdvancedOpen}/>
        {advancedOptions}
        <div>
          <RaisedButton icon={<Refresh />}
                        onClick={this.updatePassword}
                        style={{width: "48%"}}
                        primary={true} />
          {saveButton}
        </div>
      </div>)
  }
}

module.exports = GeneratePasswordMenu;
