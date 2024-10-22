clean:
	rm packages/client/tsconfig.tsbuildinfo || echo ok
	rm packages/server/tsconfig.tsbuildinfo || echo ok
	rm -rf packages/client/dist || echo ok
	rm -rf packages/server/dist || echo ok

clean-if-needed:
	sh -c "( test -e packages/client/dist/ && test -e packages/server/dist ) || make clean" 

build:
	make clean-if-needed
	cd packages/client && npx tsc
	cd packages/server && npx tsc
	npx tsc

test: build
	npx mocha

lint:
	npx eslint ./packages ./test

lint-fix:
	npx eslint --fix ./packages ./test
