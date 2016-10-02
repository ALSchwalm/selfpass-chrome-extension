import React from 'react';
import TextField from 'material-ui/TextField';
import RaisedButton from 'material-ui/RaisedButton';

const selfpass = () => chrome.extension.getBackgroundPage().selfpass;

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

module.exports = LoggedOutView;
