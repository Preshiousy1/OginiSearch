kill whatever is running on port 3000:
lsof -ti:3000 | xargs kill -9

verify that port 3000 is free:
lsof -i:3000

