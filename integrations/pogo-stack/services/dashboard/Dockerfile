FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY websocket-map.conf /etc/nginx/conf.d/00-websocket-map.conf
# Official image runs envsubst on /etc/nginx/templates/*.template → conf.d/
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV ACCOUNT_API_KEY=
ENV ROTOM_SECRET=
EXPOSE 8080
