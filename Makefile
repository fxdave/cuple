clean:
	rm packages/client/tsconfig.tsbuildinfo
	rm packages/server/tsconfig.tsbuildinfo
	rm -rf packages/client/dist
	rm -rf packages/server/dist

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
