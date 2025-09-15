.PHONY: all test clean coverage

clean:
	rm packages/client/tsconfig.tsbuildinfo || echo ok
	rm packages/server/tsconfig.tsbuildinfo || echo ok
	rm test/tsconfig.tsbuildinfo || echo ok
	rm -rf test/dist || echo ok
	rm -rf packages/client/dist || echo ok
	rm -rf packages/server/dist || echo ok

clean-if-needed:
	sh -c "( test -e packages/client/dist/ && test -e packages/server/dist ) || make clean" 

build:
	npm run build
	cd test && npx tsc

test: clean build
	npx vitest --silent="passed-only" test/src

coverage:
	npx vitest run --coverage

lint:
	npx eslint ./packages ./test

lint-fix:
	npx eslint --fix ./packages ./test
