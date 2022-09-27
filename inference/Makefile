# bootstraps a fresh environment
bootstrap: install
	export CDK_NEW_BOOTSTRAP=1;npx cdk bootstrap

install: clean
	npm i
	npm run build

clean:
	@if [ -d "node_modules" ]; then \
			npx tsc --build --clean; \
			rm -rf node_modules; \
	 fi
	@rm -rf cdk.out

deploy:
	@npx cdk deploy  --require-approval never

destroy:
	./scripts/cleanup.sh
