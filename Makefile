DOCKER_ARGS=--platform=linux/amd64

run:
	docker run -it -p 3000:3000 placeholder

docker:
	docker buildx build $(DOCKER_ARGS) -t placeholder -f Dockerfile.lambda .
