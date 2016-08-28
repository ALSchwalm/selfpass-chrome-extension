#!/usr/bin/env bash

./node_modules/.bin/watchify -v -t [ babelify ] src/js/selfpass.js -o build/js/selfpass-bundle.js &
./node_modules/.bin/watchify -v -t [ babelify ] src/js/content.jsx -o build/js/content-bundle.js &
./node_modules/.bin/watchify -v -t [ babelify ] src/js/popup.jsx -o build/js/popup-bundle.js &
./node_modules/.bin/watchify -v -t [ babelify ] src/js/fill-popup.jsx -o build/js/fill-popup-bundle.js &
./node_modules/.bin/watchify -v -t [ babelify ] src/js/generate-popup.jsx -o build/js/generate-popup-bundle.js &
./node_modules/.bin/watchify -v -t [ babelify ] src/js/keystore.jsx -o build/js/keystore-bundle.js &

for job in `jobs -p`
do
    wait $job
done
