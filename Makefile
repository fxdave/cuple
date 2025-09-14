clean:
	rm packages/client/tsconfig.tsbuildinfo || echo ok
	rm packages/server/tsconfig.tsbuildinfo || echo ok
	rm -rf packages/client/dist || echo ok
	rm -rf packages/server/dist || echo ok

clean-if-needed:
	sh -c "( test -e packages/client/dist/ && test -e packages/server/dist ) || make clean" 

build:
	npm run build

test: build
	npx mocha

lint:
	npx eslint ./packages ./test

lint-fix:
	npx eslint --fix ./packages ./test
