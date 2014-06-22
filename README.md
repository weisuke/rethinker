Rethinker
=========

Rethinker offers a minimalist ActiveRecord-like API service layer for [RethinkDB](www.rethinkdb.com), the main focus is to simplify the relational queries for has-one, has-many, many-many relationships, with filters, and nested relational query support.

#Install

````
npm install rethinker
````

#Running Tests

Ensure that RethinkDB is [installed correctly](http://www.rethinkdb.com/docs/install/), and it's listening on port 28015. Then run the tests with

````
npm test
````

#Getting started

Let's assume we have the following entries and their relationships in our model:

A onlne course can be composed by many video lectures, which can be either be public or private, and a course is enrolled by many students.

And we would like to query the following:

- All courses along with their private lectures, with video related data if it's available
- All students with email ending in '@institution.org', along with their enrolled courses

##1. Initialize rethinker with database connection string

````javascript

var Rethinker = require('rethinker').init({
  host: 'localhost',
  port: 28015,
  db: 'test',
  pool: { // optional settings for pooling (further reference: https://github.com/coopernurse/node-pool)
    max: 100,
    min: 0,
    log: false,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 15000
  }
})

````


##2. Initialize services

````javascript

var LecturesService = Rethinker.extend({
    modelName: 'Lecture',
    tableName: 'lectures', // optional, by default it takes the modelName, lowercase it, and make it plural
    relations: {
        hasOne: {
            course: {  //for simplicity, 'has one course' is the same as 'belongsTo a course'
                on: 'courseId', // attribute defined on the 'lectures' table
                from: 'Course'
            },
            video: {
                on: 'videoId',
                from: 'Video'
            }
        }
    }
});

var CoursesService = Rethinker.extend({
    modelName: 'Course',
    relations: {
        hasMany: {
            videoLectures: {
                on: 'courseId',
                from: 'Lecture',
                filter : function(lecture){ // this will be used for 'filter' method in the rethinkdb API
                  return lecture.ne(null);
                }
            },
            students: {
                on: ['courseId', 'studentId'],
                through: 'courses_students', //table 'courses_students' has to be created manually for now
                from: 'Student'
            }
        },
        hasOne: {
            privateLecture: {
                on: 'courseId',
                from: 'Lecture',
                filter: {
                    private: true
                }
            }
        }
    }
});

var StudentsService = Rethinker.extend({
    modelName: 'Student',
    relations: {
        hasMany: {
            'enrolledCourses': {
                on: ['studentId', 'courseId'],
                through: {
                    tableName: 'courses_students',
                    filter: {
                        enrolled: true
                    }
                },
                from: 'Course'
            }
        }
    }
});

var VideosService = Rethinker.extend({
    modelName: 'Video',
})

var lecturesService = new LecturesService(),
    coursesService = new CoursesService(),
    studentsService = new StudentsService(),
    videosService = new VideosService();

````

##3. Querying data

#####All courses along with their private lectures ordered by createTime, with video related data if it's available

````

coursesService.findAllCourse(null, {
  with : {
    related : 'privateLecture',
    orderBy : 'createTime desc',
    with : 'video'
  }
})

//Sample result
[{
   id : '0f5a54ea-dba3-4eda-b44f-faf17ab1c9e4',
   title : "Course I",
   privateLecture : {
      courseId : '0f5a54ea-dba3-4eda-b44f-faf17ab1c9e4',
      private : true,
      createTime : 1394630809686,
      videoId : '400693be-de3d-4f41-80d3-86f58eb26cc6'
      video : {
        id : '400693be-de3d-4f41-80d3-86f58eb26cc6',
        url : 'path/video1.mp4'
      }
      
   }
},
...
]
````

#####All students with email ending in '@institution.org', along with their enrolled courses
````
studentsService.findAllStudent(function(studentRow){ 
  return studentRow('email').match('@institution.org') 
}, {with : 'enrolledCourses'})

//Sample results

[{
  name : "Khanh Luc",
  email : "khanh@institution.org",
  enrolledCourses : [{
    id : "0f5a54ea-dba3-4eda-b44f-faf17ab1c9e4"
    title : "Course I",
  },
  ...
  ]
}
....
]

````

#CRUD operations

By initializing the service layer as: 
```
var CoursesService = Rethinker.extend({modelName : 'Course'})
```

Rethinker adds the following methods to `CoursesService.prototype`

###Create

```
CoursesService.prototype.createCourse([jsonData, options]) -> Promise
```
The `options` argument is optional. It can be an object with the fields:

- `validate` : whether to call validation method on saving the data (default = true)
- `returnVals` : whether or not to return the saved value, it also supports multiple insert (default = true)

````javascript

//Example
var coursesService = CoursesService.getService(); // returns singleton instance of coursesService
coursesService.createCourse({ // insert a single course data
  title : "Physics I"
}).then(function(course){
  //course : {id: ... , title : 'Physics I'}
})

coursesService.createCourse([ // insert multiple courses data
  { title : "Physics II"},
  { title : "Physics III"}
]).then(function(courses){
  //course : [{id: ... , title : 'Physics II'}, {id: ... , title : 'Physics III'}]
})

````


###Retrieve

```
CoursesService.prototype.findCourse([queryCriteria, options]) -> Promise
CoursesService.prototype.findAllCourse([queryCriteria, options]) -> Promise
```

The `queryCriteria` can be set as either object, function or string:

- `object/function`: the [filter](http://www.rethinkdb.com/api/javascript/#filter) method is invoked to query the data
- `string`: when options.index is not set, the value is treated as primary key, otherwise [getAll](http://www.rethinkdb.com/api/javascript/#getAll) method is invoked to query the data 

In order to query all the data in the table, the `queryCriteria` argument can be set to `null` in `findAllCourses` method 

The `options` argument is optional. It can be an object with the fields:

- `index` : same index value to be passed to the API
- `orderBy` : same as [orderBy](http://www.rethinkdb.com/api/javascript/#orderBy), with a minor syntax difference: `orderBy: r.desc('createTime')` can be written as `orderBy: 'createTime desc'`
- `fields` : same as [pluck](http://www.rethinkdb.com/api/javascript/#with_fields), it also can be provided with an array of field names: `fields : ['id', 'title', 'createTitle']`
- `with` : can be set as either string, array, or object 
  - `string` : name of the relationship previously defined
  - `array` : an array of relational query options,
  - `object` : used when need to apply some filtering or query nested relational data
    - `related` : name of the relationship relative to the resulting queried data
    - `filter` : filter the results using [filter](http://www.rethinkdb.com/api/javascript/#filter)
    - `orderBy` : order the resulting relational data
    - `fields` : pluck fields from the resulting relational data
    - `with` : in case further nested relational data need to be fetched, same options above are also applied

````javascript

//Example
var lecturesService = LecturesService.getService(), // returns singleton instance of lecturesService
    coursesService = CoursesService.getService();
    
lecturesService.findLecture('143ef66b-58fd-41d0-b019-30818841699f') // find lecture by id
lecturesService.findLecture(user.id, {index : 'userId'}) // retrieve a single lecture by secondary index 'userId'
lecturesService.findLecture({title : "Lecture I"}, {fields : 'title'}) // find lecture's title by title
lecturesService.findAllLecture(function(lecture){
  return lecture.hasFields('videoId')
}, {orderBy : 'title desc'}) // find all lectures that has the videoId attribute, ordered by title
coursesService.findAllCourse(null, { // find all the courses with enrolled students, and private video lectures ordered by title
  with : ['students', {
      related : 'lectures',
      filter : {
        private : true
      },
      orderBy : 'title',
      with : 'video'
    }
  ] 
}).then(function(courses){
  /*
    courses : [
      { 
        id : '..',
        title : 'Physics I',
        lectures : [{ id: ..., title : 'Lecture I', private : true, videoId : ..., video : {...} }...],
        students : [{ ... }]
      }, 
      ...
    ]
  */
})

````

###Update

```
CoursesService.prototype.updateCourse([jsonData, queryCriteria, options]) -> Promise
CoursesService.prototype.updateAllCourse([jsonData, queryCriteria, options]) -> Promise
```

The `jsonData` is the data to be updated, `queryCriteria` and `options` are the same ones described in [Retrieve section](#retrieve), with additional options: `validate`, `returnVals` described in the [Create section](#create)

````javascript

//Example
var videosService = VideosService.getService(); // returns singleton instance of videosService
videosService.updateVideo({url : "path/newName.mp4"}, '3e3a00a1-7d5c-4ed3-9a10-7494d81919eb').then(function(){ // update video by it's primary key
}).then(function(video){
   // video : video json data with updated values
})

videosService.updateAllVideo({url : "path/newName.mp4"}, req.user.id, {index : 'userId'}) // update all user's videos 
  .then(function(videos){
    //returns an array of updated video values
  })
````

###Delete

```
CoursesService.prototype.deleteCourse([queryCriteria, options]) -> Promise
```

`queryCriteria` and `options` are the same ones described in [Retrieve section](#retrieve)

````javascript

//Example
coursesService.findCourse({title : 'Physics I'})
  .then(function(course){
    return lecturesService.deleteLecture(course.id, {index : 'courseId'}) // delete all lectures in 'Physics I'
  })

coursesService.deleteCourse() // delete all courses
````

#Additional methods

Also the following additional methods are available, all of them return promise

````
CoursesService.prototype.validateCourse([jsonData]) -> Promise // return false to cancel the persistence task
CoursesService.prototype.beforeCreateCourse([jsonData]) -> Promise // return false to cancel the insert task
CoursesService.prototype.beforeUpdateCourse([jsonData]) -> Promise // return false to cancel the update task
CoursesService.prototype.beforeSaveCourse([jsonData]) -> Promise // return false to cancel the persistence task
CoursesService.prototype.afterCreateCourse([jsonData]) -> Promise
CoursesService.prototype.afterUpdateCourse([jsonData]) -> Promise
CoursesService.prototype.existCourse([jsonData]) -> Promise

````

#Extend default methods

Each instance of Rethinker exposes the following attributes/methods that allow to build a complex queries more easily:

- `r` : exposes the [rethinkdb API](http://www.rethinkdb.com/api/javascript/#r)
- `table` : exposes the [table](http://www.rethinkdb.com/api/javascript/#table) instance, takes the this.tableName to initialize the `r.table(this.tableName)`
- `db` : expose the DB instance with the [run](http://www.rethinkdb.com/api/javascript/#run) method
- `buildQuery` : ` function buildQuery(queryCriteria, opts, tableName) -> Promise `

````javascript

OrdersService.prototype.someOtherBusinessLogics ...

OrdersService.prototype.findAllOrder = function (queryData, opts, filters) { // override the default findAll method to support extra filter options
    !opts && (opts = {});
    !filters && (filters = {});
    var orderQuery = filters.q || "",
        query = this.buildQuery(queryData, _.merge({orderBy: [filters.sort, filters.order].join(' ')}, opts));

    if (orderQuery.length > 0) {
        query = query.filter(function (order) {
            return order('orderId').match(orderQuery)
                .or(order('code').eq(orderQuery))
                .or(order('user')('name').match(orderQuery))
                .or(order('user')('email').match(orderQuery))
                .or(order('user')('address').match(orderQuery));
        });
    }

    return this.db.run(query);
};

````

Rethinker also exposes a `DB` instance, basically it wraps around the [run](http://www.rethinkdb.com/api/javascript/#run) method using pooling and returns a promise

````javascript

var r = require('rethinkdb'),
    DB = require('rethinker').DB,
    db = new DB({
      host: 'localhost',
      port: 28015,
      db: 'test',
      pool: { // optional settings for pooling (further reference: https://github.com/coopernurse/node-pool)
        max: 100,
        min: 0,
        idleTimeoutMillis: 30000,
        reapIntervalMillis: 15000
      }
    });
    
    db.run(r.tableCreate('courses_students')).then(function(result){
    
    });

````

#Save relational data

Currently it only supports saving has-one relationships

````javascript

var BookingService = Rethinker.extend({
      modelName : 'Booking',
      relations : {
        hasOne : {
          activeOrder : {
            on : 'bookingId',
            from : 'Order',
            filter : {
              active : true
            }
            sync : true
          },
          completedOrder : {
            on : 'bookingId',
            from : 'Order',
            filter : {
              active : false,
              completed : true
            }
            sync : 'readOnly'
          }
        }
      }
    });
    
    OrdersService = Rethinker.extend({
      modelName : 'Order'
    }
})

````

The `sync` property in each `relation` declaration is used to specify whether or not to save those related data.
When inserting the following data to the database:

````

var bookingService = new BookingService();
bookingService.createBooking({
  date : new Date(),
  userId : req.user.id,
  activeOrder : {
    active : true,
    completed : false
  },
  completedOrder : {
    active : false,
    completed : true
  }
});

````

It will generate the following data in 'booking' table and the 'orders' table:

````javascript

//booking table
{
  id : 'b0de0baa-5028-4da4-ae08-456b1c0d7239'
  date : ...
  userId : ..
}

//orders table
{
  id : ...
  active : true,
  completed : false,
  bookingId : 'b0de0baa-5028-4da4-ae08-456b1c0d7239'
}

````

Notice that in order to avoid data duplicity, the `activeOrder`, and `completedOrder` attributes are not saved in the booking table. Also in the orders table, only the `activeOrder` is saved since it has the property `sync : true`

Please refer the [test](https://github.com/weisuke/rethinker/blob/master/test/test.js) file for further usage example of this option.

#FAQ

##Is this an ORM?
Not quite so, the main intend is to offer a wrapper around the official API, placing the main emphasis on querying relational (nested relational) data with less code, it's basically a mixin that decorates methods in a class prototype chain. If you are looking for fully featured ORM solution, there are couple of alternatives: [Thinky](http://thinky.io/), [Reheat](http://reheat.codetrain.io/)

##Does this offer validation layer?
Personally i use the `validate` hook along with [express-validator](https://github.com/chriso/validator.js) library to validate the incoming data manually, might consider to add a validation layer in the future releases.

##Can the API be simplified?
Like instead of `coursesService.findAllCourse`, can't it just be `courses.findAll`?
Sure thing, it's just my personal preference, when i'm refactoring, finding 'findAllCourse' usage is a lot more easier, and less error prone than just 'findAll', will consider to add an extra option for this.

##What version of RethinkDB supports?
As RethinkDB hasn't reach the LTS release yet, use of latest version of RethinkDB would be recommended.  







