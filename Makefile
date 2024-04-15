DOCKER_ARGS=--platform=linux/amd64

docker:
	docker buildx build $(DOCKER_ARGS) -t placeholder -f Dockerfile.lambda .
