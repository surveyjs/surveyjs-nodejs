# surveyjs-nodejs
Sample NodeJS backend for SurveyJS: Survey library and Survey Creator

## [SurveyJS Home Page](https://surveyjs.io/Examples/Service/)

## [Live Online Survey and Survey Creator Demo](https://surveyjs-nodejs.herokuapp.com/)


### Getting started
- Install NodeJS
- Clone this repository in the `surveyjs-nodejs` folder (and make it current directory via `cd surveyjs-nodejs`)
- Install npm packages via the `npm i` command
- Run the server via the `npm start` command

At this point demo surveyjs-nodejs service will be available at the `http://localhost:3000` address.
If everything is ok, you should see project home page with list of available surveys and links to `Survey` and `Survey Creator` pages.
- You can continue with survey via `Run` page, go through the survey and post results to the custom service.
- You can continue with Survey Creator via `Edit` page, change the survey and store survey JSON to the custom service.
- Saved survey results are available via `Results` link.


### Adding Postgresql database to the backend
- Install [docker](https://www.docker.com/) on your computer
- Build postgresql-db docker container via `docker build -t postgresql-db .` command in the `docker/postgresql-db` folder
- Start docker container via the `docker run --name dbsrv -p 5432:5432 -d postgresql-db` command
#### Note: if you are familliar with docker and docker-compose, just run `docker-compose up` from the `docker` folder instead of above commands.
- Change db adapter from InMemoryDBAdapter to Postgresql one.
