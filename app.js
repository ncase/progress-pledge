var express = require('express');
var app = express();
var port = process.env.PORT || 1337;
app.use(express.bodyParser());
app.listen(port); // The best port
console.log("App running on http://localhost:"+port);

app.get("/",function(req,res){
    res.render("index.ejs",{
        STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY
    });
});

// Set your secret key: remember to change this to your live secret key in production
// See your keys here https://manage.stripe.com/account
var stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.post("/pledge",function(req,res){

    // (Assuming you're using express - expressjs.com)
    // Get the credit card details submitted by the form
    var stripeToken = req.body.stripeToken;

    stripe.customers.create({
        card: stripeToken,
        description: 'payinguser@example.com'
    }).then(function(customer) {

        // SAVE customer for later
        res.send(customer.id);

    }, function(err) {
        console.log(err);
    });

});