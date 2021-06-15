FROM node
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN mkdir data
CMD ["npm","start"]