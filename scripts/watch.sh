#!/usr/bin/env bash

./node_modules/.bin/watchify -v -t [ babelify ] src/js/selfpass.js -o build/js/selfpass-bundle.js &
./node_modules/.bin/watchify -v -t [ babelify ] src/jsx/content.jsx -o build/js/content-bundle.js &
./node_modules/.bin/watchify -v -t [ babelify ] src/jsx/popup.jsx -o build/js/popup-bundle.js &
./node_modules/.bin/watchify -v -t [ babelify ] src/jsx/fill-popup.jsx -o build/js/fill-popup-bundle.js &
./node_modules/.bin/watchify -v -t [ babelify ] src/jsx/generate-popup.jsx -o build/js/generate-popup-bundle.js &
./node_modules/.bin/watchify -v -t [ babelify ] src/jsx/keystore.jsx -o build/js/keystore-bundle.js &

for job in `jobs -p`
do
    wait $job
done
