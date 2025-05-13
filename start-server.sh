#!/bin/bash

# Increase max heap size to 4GB and use optimized garbage collection
NODE_OPTIONS="--max-old-space-size=4096" npm run start:dev 