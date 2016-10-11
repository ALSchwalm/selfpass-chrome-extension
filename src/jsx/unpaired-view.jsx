import React from 'react';
import TextField from 'material-ui/TextField';
import RaisedButton from 'material-ui/RaisedButton';

const selfpass = () => chrome.extension.getBackgroundPage().selfpass;

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

module.exports = UnpairedView;
