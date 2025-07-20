FROM node:20

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --os=linux --cpu=x64 sharp
RUN npm install sharp -g

COPY . .
RUN npm run build

EXPOSE 3332
CMD ["npm", "run", "start"]