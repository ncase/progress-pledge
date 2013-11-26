// GOTTA CATCH 'EM ALL
var domain = require('domain').create();
domain.on('error', function(err){ console.log('Thrown: ' + err.message); });
domain.run(function(){


    var express = require('express');
    var app = express();
    app.use(express.bodyParser());

    // Listen
    var port = process.env.PORT || 1337;
    app.listen(port);
    console.log("App running on http://localhost:"+port);

    // Homepage
    app.get("/",function(req,res){
        res.render("index.ejs",{
            STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY
        });
    });

    // Admin Account
    var auth = express.basicAuth(function(user, pass) {
        return user===process.env.ADMIN_USER && pass===process.env.ADMIN_PASS;
    });

    // Admin Dashboard: All pledges
    app.get("/admin",auth,function(req,res){
        
        mongo.connect(MONGO_URI, function(err, db) {
            if(err) { return console.error(err); }
            db.collection('pledges').find().toArray(function(err,pledges){
                if(err) return console.error(err);
                res.render("AdminDashboard.ejs",{
                    pledges: pledges
                });
                db.close();
            });
        });

    });

    // Admin: Charge a pledge
    app.get("/admin/charge/:id",function(req,res){

        var _id = new ObjectID(req.params.id);
        var query = {_id:_id};

        mongo.connect(MONGO_URI, function(err, db) {
            if(err){ return console.error(err); }
            
            db.collection('pledges').find(query).toArray(function(err,results){
                if(err) { return console.error(err); }
                
                var pledge = results[0];
                if(!pledge){
                    db.close();
                    return res.send("no such pledge");
                }

                // ONLY IF UNCLAIMED
                if(pledge.stages.demo.status!=="unclaimed"){
                    db.close();
                    return res.send("pledge already claimed");
                }

                // FIXED: DEMO
                var chargeAmount = pledge.stages.demo.amount;
                var customerID = pledge.customerID;

                // CHARGE THE CUSTOMER THIS AMOUNT
                stripe.charges.create({
                    amount: chargeAmount * 100, // amount in cents, again
                    currency: 'usd',
                    customer: customerID
                }).then(function(){

                    var deferred = Q.defer();

                    // MARK AS CLAIMED
                    db.collection('pledges').update(
                        query,
                        { $set:{"stages.demo.status":"claimed"} },
                        function(err){
                            if(err) deferred.reject(err);
                            deferred.resolve(true);
                        }
                    );

                    return deferred.promise;

                }).then(function(){
                    db.close();

                    // Email the backer
                    _sendPledgeClaimedEmail(pledge);

                    // Show page
                    res.send(pledge.backer.name+" has been charged $"+chargeAmount.toFixed(2)+"! <pre></pre>");

                },function(err){
                    db.close();
                    res.send(err.message);
                });

            });
        });

    });

    // Get Pledge data
    app.get("/pledge/:id",function(req,res){

        var _id = new ObjectID(req.params.id);
        var query = {_id:_id};

        mongo.connect(MONGO_URI, function(err, db) {
            if(err){ return console.error(err); }
            
            db.collection('pledges').find(query).toArray(function(err,results){
                if(err) { return console.error(err); }
                
                var pledge = results[0];
                res.render("PledgeView.ejs",{
                    pledge: pledge
                });

                db.close();

            });

        });

    });

    // Pledge with Stripe
    var stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    app.post("/pledge",function(req,res){

        // Backer
        var backer = {
            name: req.body.backer_name,
            email: req.body.backer_email
        };

        // Stages
        var ratios;
        var stages = {
            demo: {amount:0,status:"unclaimed"},
            alpha: {amount:0,status:"unclaimed"},
            beta: {amount:0,status:"unclaimed"},
            done: {amount:0,status:"unclaimed"}
        };
        switch(req.body.pledge_split){
            case "quarter": ratios = { demo:0.25, alpha:0.25, beta:0.25, done:0.25 }; break;
            case "half": ratios = { demo:0.50, alpha:0.00, beta:0.00, done:0.50 }; break;
            case "all": ratios = { demo:1.00, alpha:0.00, beta:0.00, done:0.00 }; break;
        }
        var total = parseFloat(req.body.pledge_total);
        stages.demo.amount = Math.round((ratios.demo*total)*100)/100;
        stages.alpha.amount = Math.round((ratios.alpha*total)*100)/100;
        stages.beta.amount = Math.round((ratios.beta*total)*100)/100;
        stages.done.amount = Math.round((ratios.done*total)*100)/100;

        // Create Customer and save her.
        var stripeToken = req.body.stripeToken;
        stripe.customers.create({
            card: stripeToken,
            description: backer.email
        }).then(function(customer) {

            // SAVE customer for later
            var pledge = {
                _id: new ObjectID(),
                backer: backer,
                stages: stages,
                customerID: customer.id
            };
            return _savePledge(pledge);

        }).then(function(pledge){

            // Send email
            _sendPledgeCreatedEmail(pledge);

            // Redirect to Pledge's Page
            res.redirect("/pledge/"+pledge._id);

        },function(err) {
            console.log(err);
            res.end("An error occurred. Woopsy.");
        });

    });

    // Save Customer
    var mongo = require('mongodb').MongoClient,
        ObjectID = require('mongodb').ObjectID,
        MONGO_URI = process.env.MONGO_URI;

    var Q = require("q");

    var _savePledge = function(pledge){
        var deferred = Q.defer();
        mongo.connect(MONGO_URI, function(err, db) {
            if(err) { return deferred.reject(err); }
            // Insert new entry
            db.collection('pledges').insert(pledge,function(err,inserted){
                if(err) { return deferred.reject(err); }
                deferred.resolve(pledge);
                db.close();
            });
        });
        return deferred.promise;
    };

    // Sendgrid
    var sendgrid  = require('sendgrid')( process.env.SENDGRID_USERNAME, process.env.SENDGRID_PASSWORD );

    var _sendPledgeCreatedEmail = function(pledge){

        var email = {            
            to: pledge.backer.email,
            from: 'nick@commonly.cc',
            subject: 'Thank you for backing Nothing To Hide',
            text: 'Your progress pledge page: '+'http://fund.nothingtohide.cc/pledge/'+pledge._id
        };
 
        sendgrid.send(email, function(success, message) {
            if(!success) console.log(message);
        });
    };

    var _sendPledgeClaimedEmail = function(pledge){

        var email = {
            to: pledge.backer.email,
            from: 'nick@commonly.cc',
            subject: 'Part of your Progress Pledge has been claimed.',
            text: 'The upfront stage of your pledge has been claimed!\n\n'+
                'Your card has been charged $'+pledge.stages.demo.amount.toFixed(2)+'\n\n'+
                'Details: http://fund.nothingtohide.cc/pledge/'+pledge._id
        };

        sendgrid.send(email, function(success, message) {
            if(!success) console.log(message);
        });

    };

});