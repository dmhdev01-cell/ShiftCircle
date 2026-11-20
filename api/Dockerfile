# syntax=docker/dockerfile:1

# Build stage: Maven + JDK 21. The host has no JDK, so the build happens here.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY . .
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -DskipTests package

# Runtime stage: JRE 21 only. Verified that the Drools rule base compiles at startup without
# jdk.compiler, so the publish pipeline does not force a JDK image.
FROM eclipse-temurin:21-jre-alpine

ARG GIT_COMMIT=unknown
ENV SC_GIT_COMMIT=${GIT_COMMIT}

RUN addgroup -S app && adduser -S -G app app
WORKDIR /app
COPY --from=build /build/shiftcircle-api/target/shiftcircle-api-*.jar /app/app.jar

USER app
EXPOSE 8081
ENTRYPOINT ["java", \
            "-XX:MaxRAMPercentage=75", \
            "-XX:+ExitOnOutOfMemoryError", \
            "-Djava.io.tmpdir=/tmp", \
            "-jar", "/app/app.jar"]
