# SafeWalk
SafeWalk's repository for the 1st-party app's Backend and Frontend. 

## Build Status
[![SafeWalk App](https://github.com/STA-SafeConnect-SafeWalk/safewalk-app/actions/workflows/main.yml/badge.svg)](https://github.com/STA-SafeConnect-SafeWalk/safewalk-app/actions/workflows/main.yml)

## Ways of Working

In order to maintain the repository's order and to be able to maintain the history of the commits, please use the rules defined in the following section.

### Version Control / Git

1. Using [Convential Commit](https://www.conventionalcommits.org/en/v1.0.0/#summary) prefixes in combination with the corresponding ticket ID for our commits will simplify the recognition of a PR's purpose. So please specify your commit messages in the following way: "(feat/fix/build/chore/ci/docs/style/refactor/test/perf): [KAN-XYZ] YOUR COMMIT MESSAGE". An example looks like this: "fix: [KAN-101] Fix bug in authentication service"
2. Using `git rebase` instead of `git merge` will help us maintain a linear history of commits. To 'merge', please use: `git rebase -i <BRANCH>` in the way you would use `git merge`. Then, edit the rebase config by putting `pick` in front of the desired PR title (the main commit message) and `s` or `squash` in front of all other commits. Note: `git push --force` may be required at times, see [Atlassian Guide](https://www.atlassian.com/git/tutorials/merging-vs-rebasing). Example:
```
pick 33d5b7a fix: [KAN-101] Fix bug in authentication service
s 9480b3d fix: [KAN-101] Edit token service to use JWT
s 5c67e61 fix: [KAN-101] Remove deprecated service
```
3. Create a PR for every merge to main. At least one review by one of the code owner's is required to merge to main. 
4. All pipelines must run successfully for a PR to be merged.

### Code Conventions

The following section defines various code conventions to be followed when working in this repository. 

- Code and comments are to be written in English.
- more to be defined