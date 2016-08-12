#!/usr/bin/env bash

./node_modules/.bin/watchify -v -o build/js/selfpass-bundle.js src/js/selfpass.js &
./node_modules/.bin/watchify -v -o build/js/content-bundle.js src/js/content.js &
./node_modules/.bin/watchify -v -t [ babelify --presets [ es2015 react ] ] src/js/popup.jsx -o build/js/popup-bundle.js &

for job in `jobs -p`
do
    wait $job
done
