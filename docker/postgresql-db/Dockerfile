FROM ubuntu:16.04

RUN apt-get update
RUN apt-get -qy install language-pack-en

ENV LANGUAGE en_US.UTF-8
ENV LANG en_US.UTF-8
ENV LC_ALL en_US.UTF-8

RUN update-locale LANG=en_US.UTF-8

RUN apt-get update
RUN apt-get -y install postgresql postgresql-contrib

USER postgres

ADD initdb /var/lib/postgresql

RUN /etc/init.d/postgresql start &&\
    psql --command "ALTER USER postgres WITH PASSWORD '123456';"&&\
    createdb surveyjs &&\
    psql -U postgres -d surveyjs -f /var/lib/postgresql/init.sql

RUN echo "host all  all    0.0.0.0/0  md5" >> /etc/postgresql/9.5/main/pg_hba.conf
RUN echo "listen_addresses='*'" >> /etc/postgresql/9.5/main/postgresql.conf

EXPOSE 5432

#VOLUME	["/etc/postgresql", "/var/log/postgresql", "/var/lib/postgresql"]

CMD ["/usr/lib/postgresql/9.5/bin/postgres", "-D", "/var/lib/postgresql/9.5/main", "-c", "config_file=/etc/postgresql/9.5/main/postgresql.conf"]
