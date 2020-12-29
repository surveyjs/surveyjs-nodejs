# Sample NodeJS backend for SurveyJS: Survey library and Survey Creator


### Disclaimer
This demo illustrates how to integrate SurveyJS libraries with NodeJS backend. This demo doesn't cover all of real survey service application aspects, such as authentication, authorization, user management, access levels and different security issues. These aspects are covered by backend-specific articles, forums and documentation. This demo is just a sample of intergration and can't be used as a real service.

## [SurveyJS Home Page](https://surveyjs.io/Examples/Service/)

## [Live Online Survey and Survey Creator Demo](https://surveyjs-nodejs.herokuapp.com/)


### Getting started
- Install NodeJS.
- Clone this repository into the `surveyjs-nodejs` folder (and make it the current directory via `cd surveyjs-nodejs`).
- Install npm packages via the `npm i` command.
- Run the server via the `npm start` command.

At this point, the surveyjs-nodejs demo service will be available at `http://localhost:3000`.
If everything is ok, you should see the project home page with a list of available surveys and links to `Survey` and `Survey Creator` pages.
- You can continue with a survey via the `Run` page, go through the survey and post results to the custom service.
- You can continue with Survey Creator via the `Edit` page, change the survey and store survey JSON to the custom service.
- Saved survey results are available via the `Results` link.


### Adding Postgresql database to the backend
- Install [docker](https://www.docker.com/) on your computer.
- Build a postgresql-db docker container via the `docker build -t postgresql-db .` command in the `docker/postgresql-db` folder.
- Start the docker container via the `docker run --name dbsrv -p 5432:5432 -d postgresql-db` command.
#### Note: if you are familliar with docker and docker-compose, just run `docker-compose up` from the `docker` folder instead of above commands.
- Change db adapter from InMemoryDBAdapter to Postgresql one.
