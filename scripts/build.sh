#!/usr/bin/env bash
./node_modules/.bin/browserify -o build/js/selfpass-bundle.js src/js/selfpass.js
./node_modules/.bin/browserify -t [ babelify --presets [ es2015 react ] ] src/js/popup.jsx -o build/js/popup-bundle.js
