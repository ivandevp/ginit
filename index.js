const _ = require('lodash'),
	chalk = require('chalk'),
	clear = require('clear'),
	CLI = require('clui'),
	figlet = require('figlet'),
	fs = require('fs'),
	git = require('simple-git')(),
	GitHubApi = require('github'),
	inquirer = require('inquirer'),
	Preferences = require('preferences'),
	touch = require('touch');

const files = require('./lib/files');

const Spinner = CLI.Spinner;

clear();
console.log(
	chalk.yellow(
		figlet.textSync('Laboratoria', { horizontalLayout: 'full' })
	)
);

if (files.directoryExists('.git')) {
	console.log(chalk.red('Already a git repository!'));
	process.exit();
}

let getGithubCredentials = (callback) => {
	let questions = [
		{
			name: 'username',
			type: 'input',
			message: 'Enter your Github username or e-mail address:',
			validate: function (value) {
				if (value.length) {
					return true;
				} else {
					return 'Please enter your username or e-mail address';
				}
			}
		},
		{
			name: 'password',
			type: 'password',
			message: 'Enter your password:',
			validate: function (value) {
				if (value.length) {
					return true;
				} else {
					return 'Please enter your password';
				}
			} 
		}
	];

	inquirer.prompt(questions).then(callback);
};


let github = new GitHubApi({
	version: '3.0.0'
});

let getGithubToken = (callback) => {
	let prefs = new Preferences('ginit');
	
	if (prefs.github && prefs.github.token) {
		return callback(null, prefs.github.token);
	}

	getGithubCredentials((credentials) => {
		let status = new Spinner('Authenticating you, please wait...');
		status.start();

		github.authenticate(
			_.extend({
				type: 'basic'
			}, credentials)
		);

		github.authorization.create({
			scopes: ['user', 'public_repo', 'repo', 'repo:status'],
			note: 'ginit, the command-line tool for initializing Git repos'
		}, (err, res) => {
			status.stop();
			if (err) return callback(err);
			if (res.token) {
				prefs.github = { token: res.token };
				return callback(null, res.token);
			}
			return callback();
		})
	});
}

let createRepo = (callback) => {
	let argv = require('minimist')(process.argv.slice(2));
	let questions = [
		{
			type: 'input',
			name: 'name',
			message: 'Enter a name for the repository:',
			default: argv._[0] || files.getCurrentDirectoryBase(),
			validate: (value) => {
				if (value.length) return true;
				else return 'Please enter a name for the repository';
			}
		},
		{
			type: 'input',
			name: 'description',
			default: argv._[1] || null,
			message: 'Optionally enter a description of the repository:'
		},
		{
			type: 'list',
			name: 'visibility',
			message: 'Public or private:',
			choices: ['public', 'private'],
			default: 'public'
		}
	];

	inquirer.prompt(questions).then((answers) => {
		let status = new Spinner('Creating a repository...');
		status.start();

		let data = {
			name: answers.name,
			description: answers.description,
			private: (answers.visibility === 'private')
		};

		github.repos.create(
			data,
			(err, res) => {
				status.stop();
				if (err) return callback(err);
				return callback(null, res.clone_url);
			}
		);
	});
}

var createGitignore = (callback) => {
	let fileList = _.without(fs.readdirSync('.'), '.git', '.gitignore');
	if (fileList.length) {
		inquirer.prompt([
			{
				type: 'checkbox',
				name: 'ignore',
				message: 'Select the files and/or folders you wish to ignore:',
				choices: fileList,
				default: ['node_modules', 'bowe_components']
			}
		]).then((answers) => {
			if (answers.ignore.length) {
				fs.writeFileSync('.gitignore', answers.ignore.join('\n'));
			} else {
				touch('.gitignore');
			}
			return callback();
		});
	} else {
		touch('.gitignore');
		return callback();
	}
}

let setupRepo = (url, callback) => {
	let status = new Spinner('Setting up the repository...');
	status.start();

	git
		.init()
		.add('.gitignore')
		.add('./*')
		.commit('Initial commit')
		.addRemote('origin', url)
		.push('origin', 'master')
		.then(function() {
			status.stop();
			return callback();
		});
}

var githubAuth = (callback) => {
	getGithubToken((err, token) => {
		if (err) return callback(err);
		github.authenticate({
			type: 'oauth',
			token: token
		});
		return callback(null, token);
	});
}

githubAuth((err, authed) => {
	if (err) {
		switch (err.code) {
			case 401:
				console.log(chalk.red('Couldn\'t log you in. Please, try again.'));
				break;
			case 422:
				console.log(chalk.red('You already have an access token.'));
				break;
		}
	}
	if (authed) {
		console.log(chalk.green('Successfully authenticated.'));
		createRepo((err, url) => {
			if (err) console.log(chalk.red('An error has occured.'));
			if (url) {
				createGitignore(() => {
					setupRepo(url, (err) => {
						if (!err) console.log(chalk.green('All done!'));
					});
				});
			}
		});
	}
});