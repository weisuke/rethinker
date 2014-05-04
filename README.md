Rethinker
=========

Rethinker offers ActiveRecord-like API service layer for RethinkDB, the main focus is to simplify the relational queries for has-one, has-many, many-many relationships, with filters, and nested relational query support.

#Getting started

Let's assume we have the following entries and their relationships in our model:

A onlne course can be composed by many video lectures, which can be either be public or private, and a course is enrolled by many students.

And we would like to query the following:

- All courses along with their private lectures, with video related datas if it's available
- All students with email ending in '@institution.org', along with their enrolled courses

##Initialize rethinker with database connection string

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


##Initialize models

````javascript

var LecturesService = Rethinker.extend({
    modelName: 'Lecture',
    tableName: 'lectures', // optional, by default it takes the modelName, lowercase it, and make it plural
    relations: {
        hasOne: {
            course: {  //for simplicity, 'has one course' is the same as 'belongsTo a course'
                on: 'courseId',
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

##Querying datas

#####All courses along with their private lectures ordered by createTime, with video related datas if it's available

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

#Install

````
npm install rethinker
````

