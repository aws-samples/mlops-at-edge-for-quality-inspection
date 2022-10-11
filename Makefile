.PHONY: deploy destroy check-destroy

bootstrap-cdk:
	@cd init && ${MAKE} bootstrap

deploy: deploy-init deploy-labeling deploy-training deploy-inference

destroy: check-destroy destroy-labeling destroy-training destroy-inference destroy-init

deploy-init:
	@cd init && ${MAKE} install deploy

deploy-labeling:
	@cd labeling && ${MAKE} install deploy

deploy-training:
	@cd training && ${MAKE} install deploy

deploy-inference:
	@cd inference && ${MAKE} install deploy

destroy-init:
	@cd init && ${MAKE} destroy

destroy-labeling:
	@cd labeling && ${MAKE} destroy

destroy-training:
	@cd training && ${MAKE} destroy

destroy-inference:
	@cd inference && ${MAKE} destroy

check-destroy:
	@echo "Are you sure you want to delete the mlops @ edge sample (y/n)? " && read ans && [ $${ans:-N} == y ]
