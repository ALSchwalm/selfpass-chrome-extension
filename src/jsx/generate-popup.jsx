import React from 'react';
import ReactDOM from 'react-dom';
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';
import GeneratePasswordMenu from './generate-password-menu.jsx';
import injectTapEventPlugin from 'react-tap-event-plugin';

document.addEventListener("DOMContentLoaded", function() {
  injectTapEventPlugin();
  ReactDOM.render(
    <MuiThemeProvider>
      <GeneratePasswordMenu />
    </MuiThemeProvider>,
    document.getElementById('generate-container')
  );
});
