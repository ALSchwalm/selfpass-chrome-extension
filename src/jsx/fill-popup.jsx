import React from 'react';
import ReactDOM from 'react-dom';
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';
import injectTapEventPlugin from 'react-tap-event-plugin';

import ChromePromise from "chrome-promise";
const chromep = new ChromePromise();

import FillPasswordMenu from "./fill-password-menu.jsx";

document.addEventListener("DOMContentLoaded", async function() {
  injectTapEventPlugin();
  const credentials = await chromep.runtime.sendMessage({message:"get-credentials"});
  ReactDOM.render(
    <MuiThemeProvider>
      <FillPasswordMenu credentials={credentials}/>
    </MuiThemeProvider>,
    document.getElementById('fill-container')
  );
});
