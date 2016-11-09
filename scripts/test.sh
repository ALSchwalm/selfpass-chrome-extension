#!/usr/bin/env bash

./node_modules/.bin/watchify -v -t [ babelify ] test/test-cryptography.js -o test/build/test-cryptography-bundle.js &
./node_modules/.bin/watchify -v -t [ babelify ] test/test-keystore.js -o test/build/test-keystore-bundle.js &

for job in `jobs -p`
do
    wait $job
done
