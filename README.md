# Sample NodeJS backend for SurveyJS: Survey library and Survey Creator


### Disclaimer
This demo illustrates how to integrate SurveyJS libraries with NodeJS backend. This demo doesn't cover all of real survey service application aspects, such as authentication, authorization, user management, access levels and different security issues. These aspects are covered by backend-specific articles, forums and documentation. This demo demos is just intergration one and can't be used as a real service.

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
- Install [docker](https://www.docker.com/) and [docker-compose](https://docs.docker.com/compose/install/) on your computer
- `cd docker`
- `docker-compose up`
- Change db adapter from InMemoryDBAdapter to Postgresql one.
